import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { checkStatus, analyzeText } from './api'
import { getAllModes, getModeById, assembleMode, loadPersona, savePersona, loadProvider, saveProvider, loadModels, saveModel } from './modes'
import Editor from './components/Editor'
import FeedbackPanel from './components/FeedbackPanel'
import ModeEditor from './components/ModeEditor'
import ModelMenu from './components/ModelMenu'
import './App.css'

// 10 s from first change → max ~6 calls/min. Cloudflare's text-gen rate
// limit is 300 RPM (vs Gemini's old 10 RPM) — 10s is now far more
// conservative than necessary, but kept as-is; no functional change needed.
const AUTO_DELAY = 10_000

// Backoff delays (ms) used when an auto-analyze call hits a transient API error.
// Indexed by retry attempt; clamps to the last value once exhausted.
const RETRY_BACKOFF = [10_000, 20_000, 40_000]

// Split text into sentences. Crude but adequate: split on .!? followed by whitespace.
function splitSentences(text) {
  if (!text) return []
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Find the sentence in `target` that contains `snippet`.
function findContainingSentence(target, snippet) {
  for (const s of splitSentences(target)) {
    if (s.includes(snippet)) return s
  }
  return null
}

function cleanApiError(raw) {
  // Extract the human-readable message from Python dict repr or JSON error blobs
  const m = raw.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/)
  if (m) return m[1]
  const dot = raw.indexOf('. {')
  if (dot !== -1) return raw.slice(0, dot)
  // Cloudflare errors come through as "Cloudflare API error <code>: <msg>" —
  // strip the prefix and cap length in case the body is raw HTML.
  const cf = raw.match(/^Cloudflare API error \d+:\s*(.+)$/s)
  if (cf) return cf[1].slice(0, 200)
  return raw
}

// Covers all 4 providers: Cloudflare/OpenAI/Anthropic use HTTP status codes
// (429/500/502/503/504, plus Anthropic's 529 "overloaded"), Gemini's SDK
// errors carry UNAVAILABLE/RESOURCE_EXHAUSTED tags (often alongside a code).
function isTransientError(msg) {
  return msg.includes('429') || msg.includes('500') ||
         msg.includes('502') || msg.includes('503') || msg.includes('504') ||
         msg.includes('529') ||
         msg.includes('UNAVAILABLE') || msg.includes('RESOURCE_EXHAUSTED') ||
         msg.toLowerCase().includes('overloaded')
}

// Daily-quota exhaustion won't recover from a 10-40s backoff — Cloudflare's
// 10,000 neurons/day free allowance resets at 00:00 UTC, Gemini's free tier
// resets at midnight Pacific, and OpenAI/Anthropic billing caps don't reset
// on any short timer either. Detect it so we stop retrying and show a
// distinct, actionable message instead of pointlessly burning attempts.
//
// NOTE: Cloudflare's exact error code/message for daily neuron exhaustion is
// unconfirmed — 'neuron'/'exceeded the daily'/'daily limit' are best-effort
// matches against Cloudflare's general error vocabulary. The OpenAI/Anthropic
// 'insufficient_quota'/'billing' matches are similarly best-effort. If the
// real error doesn't match, it falls through to the transient-retry path (or
// raw message via cleanApiError) instead; revisit once these are actually
// hit in practice.
function isQuotaExhausted(msg) {
  const lower = msg.toLowerCase()
  return (
    lower.includes('neuron') ||
    lower.includes('exceeded the daily') ||
    lower.includes('daily limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('free_tier_requests') ||
    lower.includes('per day') ||
    lower.includes('perday') ||
    lower.includes('insufficient_quota') ||
    lower.includes('billing')
  )
}

const QUOTA_MESSAGES = {
  cloudflare: 'Daily Cloudflare free quota exhausted — resets at midnight UTC.',
  gemini: 'Daily Gemini free quota exhausted — resets at midnight Pacific.',
  openai: 'OpenAI quota exceeded — check your plan and billing details.',
  anthropic: 'Anthropic quota exceeded — check your plan and billing details.',
}

function defaultFocusBand() {
  const h = window.innerHeight
  return { top: Math.round(h * 0.20), bottom: Math.round(h * 0.70) }
}

export default function App() {
  const [allModes, setAllModes]           = useState(getAllModes)
  const [activeModeId, setActiveModeId]   = useState('basic')
  const [feedbackMode, setFeedbackMode]   = useState('line')  // 'line' | 'structure'
  const [issues, setIssues]               = useState([])
  const [acknowledged, setAcknowledged]   = useState(() => new Set())
  const [hoveredIssueId, setHoveredIssueId] = useState(null)
  const [selectedIssueId, setSelectedIssueId] = useState(null)
  const [isAnalyzing, setIsAnalyzing]     = useState(false)
  const [apiError, setApiError]           = useState(null)
  const [showEditor, setShowEditor]       = useState(false)
  const [focusBand, setFocusBand]         = useState(() => defaultFocusBand())
  const [autoAnalyze, setAutoAnalyze]     = useState(false)
  const [persona, setPersona]             = useState(loadPersona)
  const [provider, setProvider]           = useState(loadProvider)
  const [providerStatus, setProviderStatus] = useState(null)
  const [providerModels, setProviderModels] = useState({})
  const [models, setModels]               = useState(loadModels)

  const editorRef        = useRef(null)
  const editorColumnRef  = useRef(null)
  const panelRef         = useRef(null)
  const textRef          = useRef('')
  const modeRef          = useRef(assembleMode(getModeById('basic')))
  const abortRef         = useRef(null)
  const autoAnalyzeRef   = useRef(false)
  const autoTimerRef     = useRef(null)
  const runAnalysisRef   = useRef(null)
  // dirty = the user has made changes that have not yet produced a successful
  // analyze response. Set on every edit, cleared on a successful response.
  // While dirty + auto + transient error → keep retrying with backoff.
  const dirtyRef         = useRef(false)
  const retryAttemptRef  = useRef(0)

  // sentence text → Map<type, { mode, modeId, flag, action, suggestion }>
  // One slot per (sentence, type) so a sentence flagged for both clarity and
  // word_choice carries both judgments forward. Without per-type slots, the
  // last-written flag overwrites the prior one and the model has no record of
  // it on the next call → flip-flopping. Session-only; cleared on reload.
  const sentenceHistoryRef = useRef(new Map())

  useEffect(() => {
    const mode = getModeById(activeModeId)
    modeRef.current = assembleMode(mode)
  }, [activeModeId, allModes])

  const refreshStatus = useCallback(() => {
    checkStatus().then(({ providers, models: pm }) => {
      if (providers) setProviderStatus(providers)
      if (pm) setProviderModels(pm)
    })
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

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

  // Snap focus band top to the actual top of the white page after mount
  useLayoutEffect(() => {
    if (!providerStatus) return
    const editorEl = editorColumnRef.current?.querySelector('.editor')
    if (!editorEl) return
    const top = Math.round(editorEl.getBoundingClientRect().top)
    setFocusBand((b) => ({ ...b, top }))
  }, [providerStatus])

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

    // Build history payload: one entry per (sentence, type) judgment, where
    // (a) the sentence is still present verbatim in the target, and
    // (b) the judgment's type is one the current request is asking about.
    // Edited sentences fall out automatically — the old sentence key won't be
    // in the new target. A judgment for a type the user has turned off this
    // round is also excluded; the model is free to look at that dimension fresh.
    const history = []
    if (feedbackMode === 'line') {
      const currentTypes = new Set(types)
      const targetSentences = new Set(splitSentences(snap.target))
      for (const [sentence, perType] of sentenceHistoryRef.current) {
        if (!targetSentences.has(sentence)) continue
        for (const [type, entry] of perType) {
          if (entry.mode !== 'line') continue
          if (!currentTypes.has(type)) continue
          history.push({
            sentence,
            flag: entry.flag,
            action: entry.action,
            suggestion: entry.suggestion,
          })
        }
      }
    }

    analyzeText(
      {
        target: snap.target,
        context_before: snap.context_before,
        context_after: snap.context_after,
        mode: feedbackMode,
        instructions: feedbackMode === 'line' ? instructions : '',
        types: feedbackMode === 'line' ? types : [],
        history,
        persona,
        provider,
        model: models[provider],
      },
      ctrl.signal,
    )
      .then(({ issues: found }) => {
        if (ctrl.signal.aborted) return
        // Successful response: nothing to retry, no pending feedback owed.
        dirtyRef.current = false
        retryAttemptRef.current = 0
        // Sticky-flag rule: an issue stays on screen until the user has
        // acknowledged it (opened it, applied it, or edited the sentence away).
        // New analyses can ADD issues but can't silently DROP unacknowledged ones.
        setIssues((prev) => {
          const ackd = acknowledged
          const survivors = prev.filter((i) => {
            if (ackd.has(i.id)) return false               // already dealt with
            return snap.target.includes(i.text)            // sentence still present
          })
          // Dedup key prefers (containing-sentence, type) so the model rephrasing
          // the span boundaries on the same sentence doesn't spawn a duplicate
          // card. Falls back to (text, type) when the span doesn't map cleanly
          // to one sentence (multi-sentence spans, splitter misses).
          const keyFor = (text, type) => {
            const sentence = findContainingSentence(snap.target, text)
            return sentence
              ? `s\x00${sentence}\x00${type}`
              : `t\x00${text}\x00${type}`
          }
          const seen = new Set(survivors.map((i) => keyFor(i.text, i.type)))
          const merged = [...survivors]
          for (const issue of found) {
            const key = keyFor(issue.text, issue.type)
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(issue)
          }
          // Prune acknowledged IDs that no longer correspond to any visible issue,
          // so the set doesn't grow unboundedly during long sessions.
          const visibleIds = new Set(merged.map((i) => i.id))
          setAcknowledged((s) => {
            let changed = false
            const next = new Set()
            for (const id of s) {
              if (visibleIds.has(id)) next.add(id)
              else changed = true
            }
            return changed ? next : s
          })
          return merged
        })
        // Record each flagged sentence in history, indexed by (sentence, type)
        // so multiple flag types on the same sentence each carry forward.
        if (feedbackMode === 'line') {
          for (const issue of found) {
            const sentence = findContainingSentence(snap.target, issue.text)
            if (!sentence) continue
            let perType = sentenceHistoryRef.current.get(sentence)
            if (!perType) {
              perType = new Map()
              sentenceHistoryRef.current.set(sentence, perType)
            }
            perType.set(issue.type, {
              mode: 'line',
              modeId: activeModeId,
              flag: issue.type,
              action: 'flagged',
              suggestion: issue.suggestions?.[0] ?? '',
            })
          }
        }
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        if (ctrl.signal.aborted) return
        console.error('Analysis failed:', e)
        const msg = e.message || 'Analysis failed'
        // Daily-quota exhaustion: don't retry, quota resets at midnight PT.
        if (isQuotaExhausted(msg)) {
          retryAttemptRef.current = 0
          dirtyRef.current = false
          if (autoTimerRef.current) {
            clearTimeout(autoTimerRef.current)
            autoTimerRef.current = null
          }
          setApiError(QUOTA_MESSAGES[provider] || 'Daily quota exhausted.')
          return
        }
        // Transient + auto + still dirty → keep retrying with backoff until we
        // get one successful response. This guarantees "every change gets at
        // least one piece of feedback eventually."
        const shouldRetry =
          isTransientError(msg) &&
          autoAnalyzeRef.current &&
          dirtyRef.current &&
          !autoTimerRef.current
        if (shouldRetry) {
          const idx = Math.min(retryAttemptRef.current, RETRY_BACKOFF.length - 1)
          const delay = RETRY_BACKOFF[idx]
          retryAttemptRef.current += 1
          autoTimerRef.current = setTimeout(() => {
            autoTimerRef.current = null
            runAnalysisRef.current?.()
          }, delay)
          setApiError(`API busy – retrying in ${Math.round(delay / 1000)}s…`)
        } else {
          setApiError(cleanApiError(msg))
        }
      })
      .finally(() => { if (!ctrl.signal.aborted) setIsAnalyzing(false) })
  }, [feedbackMode, activeModeId, acknowledged, persona, provider, models])

  // Keep runAnalysisRef current so the auto-timer closure never goes stale
  useEffect(() => { runAnalysisRef.current = runAnalysis }, [runAnalysis])

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
    dirtyRef.current = true
    if (autoAnalyzeRef.current && !autoTimerRef.current) {
      autoTimerRef.current = setTimeout(() => {
        autoTimerRef.current = null
        runAnalysisRef.current?.()
      }, AUTO_DELAY)
    }
  }, [])  // stable — reads only refs, no state deps

  function toggleAutoAnalyze() {
    setAutoAnalyze((prev) => {
      const next = !prev
      autoAnalyzeRef.current = next
      if (!next) {
        clearTimeout(autoTimerRef.current)
        autoTimerRef.current = null
        retryAttemptRef.current = 0
      }
      return next
    })
  }

  const handleApply = useCallback((issueText, suggestion) => {
    editorRef.current?.applyFix(issueText, suggestion)
    setIssues((prev) => {
      // We need the matched issue's type to mark only THAT (sentence, type)
      // slot as accepted; sibling flags on the same sentence (different types)
      // should keep their "flagged" status. Look it up before filtering.
      const matched = prev.filter((i) => i.text === issueText)
      if (matched.length) {
        // Acknowledge each so the next analyze can't re-introduce them.
        const droppedIds = matched.map((i) => i.id)
        setAcknowledged((s) => {
          const next = new Set(s)
          for (const id of droppedIds) next.add(id)
          return next
        })
        // Update sentence history: mark the accepted type, leave siblings.
        // Then re-key the whole inner map to the post-edit sentence text so
        // the next analyze's lookup (which uses the new sentence) finds it.
        const oldSentence = findContainingSentence(textRef.current, issueText)
        const perType = oldSentence ? sentenceHistoryRef.current.get(oldSentence) : null
        if (oldSentence && perType) {
          for (const issue of matched) {
            const slot = perType.get(issue.type)
            if (slot) perType.set(issue.type, { ...slot, action: 'accepted' })
          }
          const newSentence = oldSentence.replace(issueText, suggestion)
          if (newSentence !== oldSentence) {
            sentenceHistoryRef.current.delete(oldSentence)
            sentenceHistoryRef.current.set(newSentence, perType)
          }
        }
      }
      return prev.filter((i) => i.text !== issueText)
    })
  }, [])

  const handleIssueClick = useCallback((issueId) => {
    // The panel calls this with `null` to collapse and with an id to (toggle-)expand.
    // Treat a non-null id as an "opened" event for acknowledgement purposes.
    setSelectedIssueId((prev) => {
      if (issueId == null) return null
      const opening = prev !== issueId
      if (opening) {
        setAcknowledged((s) => {
          if (s.has(issueId)) return s
          const next = new Set(s)
          next.add(issueId)
          return next
        })
      }
      return opening ? issueId : null
    })
  }, [])

  function handleModeSelect(id) {
    setAllModes(getAllModes())
    setActiveModeId(id)
  }

  function handlePersonaChange(next) {
    setPersona(next)
    savePersona(next)
  }

  function handleProviderChange(next) {
    setProvider(next)
    saveProvider(next)
  }

  function handleModelChange(providerId, modelId) {
    setModels((m) => ({ ...m, [providerId]: modelId }))
    saveModel(providerId, modelId)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (providerStatus === null) return <div className="loading">Loading…</div>

  const noProviderConfigured = Object.values(providerStatus).every((v) => !v)

  return (
    <div className="app">
      {noProviderConfigured && (
        <div className="config-banner">
          No LLM provider configured — open the model menu (top left) and add an API key for at least one provider to enable analysis.
        </div>
      )}
      <header className="app-header">
        <span className="app-title">Writing Assistant</span>

        <ModelMenu
          provider={provider}
          onProviderChange={handleProviderChange}
          models={models}
          onModelChange={handleModelChange}
          providerStatus={providerStatus}
          providerModels={providerModels}
          onCredentialsSaved={refreshStatus}
        />

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
          className={`auto-btn ${autoAnalyze ? 'active' : ''}`}
          onClick={toggleAutoAnalyze}
          title={autoAnalyze ? `Auto-analyze every ${AUTO_DELAY / 1000}s after first edit (click to disable)` : 'Enable auto-analyze'}
        >
          {autoAnalyze ? 'Auto' : 'Manual'}
        </button>

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
        <div className="editor-column" ref={editorColumnRef}>
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
          onSelect={handleIssueClick}
          onApply={handleApply}
        />
      </main>

      {showEditor && (
        <ModeEditor
          currentModeId={activeModeId}
          onClose={() => setShowEditor(false)}
          onSelectMode={handleModeSelect}
          persona={persona}
          onPersonaChange={handlePersonaChange}
        />
      )}
    </div>
  )
}
