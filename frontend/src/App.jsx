import { useState, useEffect, useRef, useCallback } from 'react'
import { checkStatus, analyzeText } from './api'
import { getAllModes, getModeById, assembleMode } from './modes'
import SetupScreen from './components/SetupScreen'
import Editor from './components/Editor'
import FeedbackBubble from './components/FeedbackBubble'
import ModeEditor from './components/ModeEditor'
import './App.css'

const CHAR_THRESHOLD  = 150    // new characters typed since last analysis (~30-40s for an average typist)
const TIMER_INTERVAL  = 20000  // 20 seconds
const COOLDOWN_MS     = 15000  // min gap between API calls — keeps us under gemini-3.5-flash's 5 RPM free tier

export default function App() {
  const [configured, setConfigured]     = useState(null)
  const [allModes, setAllModes]         = useState(getAllModes)
  const [activeModeId, setActiveModeId] = useState('basic')
  const [triggerMode, setTriggerMode]   = useState('auto') // 'auto' | 'manual'
  const [issues, setIssues]             = useState([])
  const [activeBubble, setActiveBubble] = useState(null)
  const [isAnalyzing, setIsAnalyzing]   = useState(false)
  const [apiError, setApiError]         = useState(null)
  const [showEditor, setShowEditor]     = useState(false)

  const editorRef          = useRef(null)
  const issueMapRef        = useRef({})
  const textRef            = useRef('')
  const modeRef            = useRef(assembleMode(getModeById('basic')))
  const abortRef           = useRef(null)
  const cooldownRef        = useRef(null)
  const lastCalledRef      = useRef(0)
  const lastAnalyzedTextRef = useRef('') // text at the time of the last analysis

  useEffect(() => {
    const mode = getModeById(activeModeId)
    modeRef.current = assembleMode(mode)
  }, [activeModeId, allModes])

  useEffect(() => {
    issueMapRef.current = Object.fromEntries(issues.map((i) => [i.id, i]))
  }, [issues])

  useEffect(() => {
    checkStatus().then(({ configured }) => setConfigured(configured))
  }, [])

  // ── Analysis ──────────────────────────────────────────────────────────────────

  const doAnalysis = useCallback((text) => {
    if (abortRef.current) abortRef.current.abort()
    if (!text.trim()) { setIssues([]); return }

    const { instructions, types } = modeRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setIsAnalyzing(true)
    setApiError(null)
    lastAnalyzedTextRef.current = text  // mark what we're about to analyze

    analyzeText(text, instructions, types, ctrl.signal)
      .then(({ issues: found }) => { if (!ctrl.signal.aborted) setIssues(found) })
      .catch((e) => {
        if (e.name === 'AbortError') return
        console.error('Analysis failed:', e)
        if (!ctrl.signal.aborted) setApiError(e.message || 'Analysis failed')
      })
      .finally(() => { if (!ctrl.signal.aborted) setIsAnalyzing(false) })
  }, [])

  // Rate-limited: queues the call if within cooldown, never drops it
  const runAnalysis = useCallback((text) => {
    if (cooldownRef.current) clearTimeout(cooldownRef.current)
    const wait = COOLDOWN_MS - (Date.now() - lastCalledRef.current)
    if (wait <= 0) {
      lastCalledRef.current = Date.now()
      doAnalysis(text)
    } else {
      cooldownRef.current = setTimeout(() => {
        lastCalledRef.current = Date.now()
        doAnalysis(textRef.current)
      }, wait)
    }
  }, [doAnalysis])

  // Re-analyze immediately when the user switches mode
  useEffect(() => {
    if (textRef.current.trim()) runAnalysis(textRef.current)
  }, [activeModeId, runAnalysis])

  // 20-second timer trigger (auto mode only)
  useEffect(() => {
    if (triggerMode !== 'auto') return
    const interval = setInterval(() => {
      const text = textRef.current
      if (text.trim() && text !== lastAnalyzedTextRef.current) {
        runAnalysis(text)
      }
    }, TIMER_INTERVAL)
    return () => clearInterval(interval)
  }, [triggerMode, runAnalysis])

  // ── Event handlers ────────────────────────────────────────────────────────────

  const handleTextChange = useCallback((text) => {
    textRef.current = text
    setActiveBubble(null)

    // Character-count trigger (auto mode only) — only counts additions, not deletions
    if (triggerMode !== 'auto' || !text.trim()) return
    const added = text.length - lastAnalyzedTextRef.current.length
    if (added >= CHAR_THRESHOLD) runAnalysis(text)
  }, [triggerMode, runAnalysis])

  const handleIssueClick = useCallback((issueId, anchorRect) => {
    const issue = issueMapRef.current[issueId]
    if (issue) setActiveBubble({ issue, anchorRect })
  }, [])

  const handleApply = useCallback((issueText, suggestion) => {
    editorRef.current?.applyFix(issueText, suggestion)
    setActiveBubble(null)
    setIssues((prev) => prev.filter((i) => i.text !== issueText))
  }, [])

  function handleModeSelect(id) {
    setAllModes(getAllModes())
    setActiveModeId(id)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (configured === null) return <div className="loading">Loading…</div>
  if (!configured) return <SetupScreen onComplete={() => setConfigured(true)} />

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Writing Assistant</span>

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

        <div className="trigger-selector">
          <button
            className={`trigger-btn ${triggerMode === 'auto' ? 'active' : ''}`}
            onClick={() => setTriggerMode('auto')}
            title="Analyze every 20 seconds or every 10 new words"
          >
            Auto
          </button>
          <button
            className={`trigger-btn ${triggerMode === 'manual' ? 'active' : ''}`}
            onClick={() => setTriggerMode('manual')}
            title="Analyze only when you click the button"
          >
            Manual
          </button>
        </div>

        {triggerMode === 'manual' && (
          <button
            className="analyze-btn"
            onClick={() => runAnalysis(textRef.current)}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? 'Analyzing…' : 'Analyze'}
          </button>
        )}

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

      <main className="editor-container">
        <Editor
          ref={editorRef}
          issues={issues}
          onTextChange={handleTextChange}
          onIssueClick={handleIssueClick}
        />
      </main>

      {activeBubble && (
        <FeedbackBubble
          issue={activeBubble.issue}
          anchorRect={activeBubble.anchorRect}
          onApply={handleApply}
          onDismiss={() => setActiveBubble(null)}
        />
      )}

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
