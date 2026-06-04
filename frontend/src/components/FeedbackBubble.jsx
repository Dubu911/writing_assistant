import { useState, useRef, useEffect } from 'react'
import MiniChat from './MiniChat'

const TYPE_LABELS = {
  grammar: 'Grammar',
  clarity: 'Clarity',
  tone: 'Tone',
  passive: 'Passive Voice',
  conciseness: 'Conciseness',
  word_choice: 'Word Choice',
}

export default function FeedbackBubble({ issue, anchorRect, onApply, onDismiss }) {
  const [showChat, setShowChat] = useState(false)
  const bubbleRef = useRef(null)

  // Position bubble below the highlighted word, clamped to viewport
  const top = anchorRect.bottom + window.scrollY + 8
  const left = Math.max(8, Math.min(anchorRect.left + window.scrollX, window.innerWidth - 336))

  // Click outside → dismiss
  useEffect(() => {
    function handler(e) {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target)) {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onDismiss])

  return (
    <div
      ref={bubbleRef}
      className={`bubble bubble-${issue.type}`}
      style={{ position: 'absolute', top, left, width: 320, zIndex: 1000 }}
    >
      <div className="bubble-header">
        <span className="bubble-type">{TYPE_LABELS[issue.type] ?? issue.type}</span>
        <button className="bubble-close" onClick={onDismiss}>×</button>
      </div>

      <p className="bubble-explanation">{issue.explanation}</p>

      <div className="bubble-suggestions">
        {issue.suggestions.map((s, i) => (
          <button key={i} className="suggestion-btn" onClick={() => onApply(issue.text, s)}>
            {s}
          </button>
        ))}
      </div>

      <button className="chat-toggle" onClick={() => setShowChat((v) => !v)}>
        {showChat ? '↑ Close chat' : '💬 Ask about this'}
      </button>

      {showChat && (
        <MiniChat
          sessionId={issue.id}
          context={{
            issue_text: issue.text,
            issue_type: issue.type,
            explanation: issue.explanation,
            suggestions: issue.suggestions,
          }}
        />
      )}
    </div>
  )
}
