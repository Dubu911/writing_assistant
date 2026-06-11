// All requests go to /api/... which Vite proxies to http://localhost:8000 during dev

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const checkStatus = () =>
  request('/api/status')

export const saveApiKey = (payload) =>
  request('/api/setup', { method: 'POST', body: JSON.stringify(payload) })

export const getApiKey = (provider) =>
  request(`/api/credentials/${provider}`)

export const analyzeText = (
  { target, context_before = '', context_after = '', mode = 'line', instructions = '', types = [], history = [], persona = '', provider = 'cloudflare', model = '' },
  signal,
) =>
  request('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ target, context_before, context_after, mode, instructions, types, history, persona, provider, model }),
    signal,
  })

export const sendChatMessage = (session_id, message, context, persona = '', provider = 'cloudflare', model = '') =>
  request('/api/chat', { method: 'POST', body: JSON.stringify({ session_id, message, context, persona, provider, model }) })
