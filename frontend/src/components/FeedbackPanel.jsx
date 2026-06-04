import { useEffect, useState, useLayoutEffect, useRef } from 'react'

const TYPE_LABELS = {
  grammar: 'Grammar',
  clarity: 'Clarity',
  tone: 'Tone',
  passive: 'Passive Voice',
  conciseness: 'Conciseness',
  word_choice: 'Word Choice',
  length: 'Sentence Length',
  hedging: 'Hedging',
  transitions: 'Transitions',
  flow: 'Argument Flow',
  pacing: 'Pacing',
  organization: 'Organization',
  transition: 'Transition',
  coherence: 'Coherence',
  custom: 'Note',
}

/**
 * Cards align vertically with the document text they reference.
 * Collapsed: shows only the flag. Click to expand.
 * Hover propagates both ways via onHover.
 */
export default function FeedbackPanel({
  issues,
  panelRef,
  hoveredIssueId,
  selectedIssueId,
  onHover,
  onSelect,
  onApply,
}) {
  const [positions, setPositions] = useState({}) // issueId -> top (px relative to panel)
  const cardsRef = useRef({})

  // Measure each highlighted issue's position in the document
  useLayoutEffect(() => {
    if (!panelRef.current) return
    const panelTop = panelRef.current.getBoundingClientRect().top
    const next = {}
    for (const issue of issues) {
      const mark = document.querySelector(`mark[data-issue-id="${issue.id}"]`)
      if (!mark) continue
      const r = mark.getBoundingClientRect()
      next[issue.id] = r.top - panelTop
    }
    // Avoid overlap: push later cards down so they don't collide
    const sorted = [...issues].sort((a, b) => (next[a.id] ?? 0) - (next[b.id] ?? 0))
    let lastBottom = -Infinity
    for (const issue of sorted) {
      if (next[issue.id] == null) continue
      const minTop = lastBottom + 8
      if (next[issue.id] < minTop) next[issue.id] = minTop
      const h = cardsRef.current[issue.id]?.offsetHeight ?? 44
      lastBottom = next[issue.id] + h
    }
    setPositions(next)
  }, [issues, panelRef, selectedIssueId])

  // Auto-scroll the panel when an issue is hovered or selected in the document
  useEffect(() => {
    const id = selectedIssueId || hoveredIssueId
    if (!id) return
    const node = cardsRef.current[id]
    node?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [hoveredIssueId, selectedIssueId])

  if (issues.length === 0) {
    return (
      <aside className="feedback-panel" ref={panelRef}>
        <div className="feedback-empty">No feedback yet.<br/>Press <kbd>Shift</kbd>+<kbd>Enter</kbd> to analyze.</div>
      </aside>
    )
  }

  return (
    <aside className="feedback-panel" ref={panelRef}>
      {issues.map((issue) => {
        const isSelected = selectedIssueId === issue.id
        const isHovered = hoveredIssueId === issue.id
        const top = positions[issue.id]
        return (
          <div
            key={issue.id}
            ref={(el) => { if (el) cardsRef.current[issue.id] = el }}
            className={`fb-card fb-card-${issue.type} ${isSelected ? 'fb-expanded fb-selected' : ''} ${isHovered ? 'fb-hovered' : ''}`}
            style={top != null ? { position: 'absolute', top, right: 12, left: 12 } : undefined}
            onMouseEnter={() => onHover?.(issue.id)}
            onMouseLeave={() => onHover?.(null)}
            onClick={() => onSelect?.(isSelected ? null : issue.id)}
          >
            <div className="fb-flag">
              <span className="fb-type">{TYPE_LABELS[issue.type] ?? issue.type}</span>
              <span className="fb-chev">{isSelected ? '▾' : '▸'}</span>
            </div>
            {isSelected && (
              <div className="fb-body" onClick={(e) => e.stopPropagation()}>
                <p className="fb-explanation">{issue.explanation}</p>
                {issue.suggestions?.length > 0 && (
                  <div className="fb-suggestions">
                    {issue.suggestions.map((s, i) => (
                      <button
                        key={i}
                        className="fb-suggestion"
                        onClick={() => onApply(issue.text, s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}
