import { useState, useRef, useEffect } from 'react'
import { sendChatMessage } from '../api'

export default function MiniChat({ sessionId, context }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)
    try {
      const { reply } = await sendChatMessage(sessionId, text, context)
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mini-chat">
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-hint">Ask why this is wrong, what a word means, or anything about this suggestion.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && <div className="chat-msg chat-msg-assistant chat-loading">···</div>}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask a question…"
          autoFocus
        />
        <button className="chat-send" onClick={send} disabled={loading}>
          →
        </button>
      </div>
    </div>
  )
}
