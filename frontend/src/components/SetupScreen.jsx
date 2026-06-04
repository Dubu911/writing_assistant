import { useState } from 'react'
import { saveApiKey } from '../api'

export default function SetupScreen({ onComplete }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!key.trim()) return
    setLoading(true)
    setError('')
    try {
      await saveApiKey(key.trim())
      onComplete()
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <h1>Writing Assistant</h1>
        <p>
          Enter your Gemini API key to get started. It will be saved in a local{' '}
          <code>.env</code> file on your machine and is never uploaded or shared.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="setup-input"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            autoFocus
            spellCheck={false}
          />
          {error && <p className="setup-error">{error}</p>}
          <button type="submit" className="setup-btn" disabled={loading || !key.trim()}>
            {loading ? 'Validating…' : 'Save & Continue'}
          </button>
        </form>
        <p className="setup-note">
          No API key? Get one free at{' '}
          <span style={{ color: '#555', fontFamily: 'monospace' }}>aistudio.google.com</span>
        </p>
      </div>
    </div>
  )
}
