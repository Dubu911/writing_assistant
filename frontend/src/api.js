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

export const saveApiKey = (api_key) =>
  request('/api/setup', { method: 'POST', body: JSON.stringify({ api_key }) })

export const analyzeText = (
  { target, context_before = '', context_after = '', mode = 'line', instructions = '', types = [] },
  signal,
) =>
  request('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ target, context_before, context_after, mode, instructions, types }),
    signal,
  })

export const sendChatMessage = (session_id, message, context) =>
  request('/api/chat', { method: 'POST', body: JSON.stringify({ session_id, message, context }) })
