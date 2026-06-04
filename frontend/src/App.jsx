import { useState, useEffect, useRef, useCallback } from 'react'
import { checkStatus, analyzeText } from './api'
import { getAllModes, getModeById, assembleMode } from './modes'
import SetupScreen from './components/SetupScreen'
import Editor from './components/Editor'
import FeedbackPanel from './components/FeedbackPanel'
import ModeEditor from './components/ModeEditor'
import './App.css'

function defaultFocusBand() {
  const h = window.innerHeight
  return { top: Math.round(h * 0.20), bottom: Math.round(h * 0.70) }
}

export default function App() {
  const [configured, setConfigured]       = useState(null)
  const [allModes, setAllModes]           = useState(getAllModes)
  const [activeModeId, setActiveModeId]   = useState('basic')
  const [feedbackMode, setFeedbackMode]   = useState('line')  // 'line' | 'structure'
  const [issues, setIssues]               = useState([])
  const [hoveredIssueId, setHoveredIssueId] = useState(null)
  const [selectedIssueId, setSelectedIssueId] = useState(null)
  const [isAnalyzing, setIsAnalyzing]     = useState(false)
  const [apiError, setApiError]           = useState(null)
  const [showEditor, setShowEditor]       = useState(false)
  const [focusBand, setFocusBand]         = useState(() => defaultFocusBand())

  const editorRef   = useRef(null)
  const panelRef    = useRef(null)
  const textRef     = useRef('')
  const modeRef     = useRef(assembleMode(getModeById('basic')))
  const abortRef    = useRef(null)

  useEffect(() => {
    const mode = getModeById(activeModeId)
    modeRef.current = assembleMode(mode)
  }, [activeModeId, allModes])

  useEffect(() => {
    checkStatus().then(({ configured }) => setConfigured(configured))
  }, [])

  // Keep focus band valid across window resizes
  useEffect(() => {
    function onResize() {
      setFocusBand((b) => {
        const h = window.innerHeight
        return {
          top: Math.min(b.top, h - 80),
          bottom: Math.min(b.bottom, h - 20),
        }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Analysis ──────────────────────────────────────────────────────────────
  const runAnalysis = useCallback(() => {
    const snap = editorRef.current?.captureSnapshot()
    if (!snap || !snap.target.trim()) {
      setApiError(
        feedbackMode === 'structure'
          ? 'Select some text first, then press Shift+Enter.'
          : 'Move the focus band over some text first.',
      )
      return
    }
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const { instructions, types } = modeRef.current
    setIsAnalyzing(true)
    setApiError(null)

    analyzeText(
      {
        target: snap.target,
        context_before: snap.context_before,
        context_after: snap.context_after,
        mode: feedbackMode,
        instructions: feedbackMode === 'line' ? instructions : '',
        types: feedbackMode === 'line' ? types : [],
      },
      ctrl.signal,
    )
      .then(({ issues: found }) => { if (!ctrl.signal.aborted) setIssues(found) })
      .catch((e) => {
        if (e.name === 'AbortError') return
        console.error('Analysis failed:', e)
        if (!ctrl.signal.aborted) setApiError(e.message || 'Analysis failed')
      })
      .finally(() => { if (!ctrl.signal.aborted) setIsAnalyzing(false) })
  }, [feedbackMode])

  // Shift+Enter triggers analyze from anywhere
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        runAnalysis()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runAnalysis])

  // ── Event handlers ────────────────────────────────────────────────────────
  const handleTextChange = useCallback((text) => {
    textRef.current = text
  }, [])

  const handleApply = useCallback((issueText, suggestion) => {
    editorRef.current?.applyFix(issueText, suggestion)
    setIssues((prev) => prev.filter((i) => i.text !== issueText))
  }, [])

  const handleIssueClick = useCallback((issueId) => {
    setSelectedIssueId((prev) => (prev === issueId ? null : issueId))
  }, [])

  function handleModeSelect(id) {
    setAllModes(getAllModes())
    setActiveModeId(id)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (configured === null) return <div className="loading">Loading…</div>
  if (!configured) return <SetupScreen onComplete={() => setConfigured(true)} />

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Writing Assistant</span>

        <div className="feedback-mode-toggle">
          <button
            className={`fm-btn ${feedbackMode === 'line' ? 'active' : ''}`}
            onClick={() => setFeedbackMode('line')}
            title="Sentence-level feedback within the focus band"
          >
            Line
          </button>
          <button
            className={`fm-btn ${feedbackMode === 'structure' ? 'active' : ''}`}
            onClick={() => setFeedbackMode('structure')}
            title="Structural feedback on selected text"
          >
            Structure
          </button>
        </div>

        {feedbackMode === 'line' && (
          <div className="mode-selector">
            {allModes.map((m) => (
              <button
                key={m.id}
                className={`mode-btn ${m.id === activeModeId ? 'active' : ''}`}
                onClick={() => setActiveModeId(m.id)}
                title={m.checks.filter(c => c.enabled).map(c => c.label).join(', ')}
              >
                {m.name}
              </button>
            ))}
            <button className="mode-edit-btn" onClick={() => setShowEditor(true)} title="Manage modes">
              ⚙
            </button>
          </div>
        )}

        <button
          className="analyze-btn"
          onClick={runAnalysis}
          disabled={isAnalyzing}
          title="Shift+Enter"
        >
          {isAnalyzing ? 'Analyzing…' : 'Analyze (⇧↵)'}
        </button>

        <span className="status-label">
          {apiError
            ? <span className="status-error" title={apiError}>⚠ {apiError}</span>
            : isAnalyzing
            ? 'Analyzing…'
            : issues.length > 0
            ? `${issues.length} issue${issues.length !== 1 ? 's' : ''}`
            : ''}
        </span>
      </header>

      <main className="workspace">
        <div className="editor-column">
          <Editor
            ref={editorRef}
            issues={issues}
            mode={feedbackMode}
            focusBand={focusBand}
            onFocusBandChange={setFocusBand}
            onTextChange={handleTextChange}
            onIssueClick={handleIssueClick}
            onIssueHover={setHoveredIssueId}
            hoveredIssueId={hoveredIssueId}
            selectedIssueId={selectedIssueId}
          />
        </div>
        <FeedbackPanel
          panelRef={panelRef}
          issues={issues}
          hoveredIssueId={hoveredIssueId}
          selectedIssueId={selectedIssueId}
          onHover={setHoveredIssueId}
          onSelect={setSelectedIssueId}
          onApply={handleApply}
        />
      </main>

      {showEditor && (
        <ModeEditor
          currentModeId={activeModeId}
          onClose={() => setShowEditor(false)}
          onSelectMode={handleModeSelect}
        />
      )}
    </div>
  )
}
