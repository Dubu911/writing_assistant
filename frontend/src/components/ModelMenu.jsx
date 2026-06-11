import { useState, useEffect, useRef } from 'react'
import { saveApiKey, getApiKey } from '../api'

const PROVIDERS = [
  { id: 'cloudflare', label: 'Cloudflare Workers AI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
]

// Friendly display names for known model ids. Unrecognized ids (e.g. a new
// model added to PROVIDER_MODELS on the backend) fall back to the raw id.
const MODEL_LABELS = {
  '@cf/meta/llama-3.1-8b-instruct-fp8': 'Llama 3.1 8B',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': 'Llama 3.3 70B',
  'gemini-2.5-flash-lite': 'Flash-Lite',
  'gemini-2.5-flash': 'Flash',
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4o': 'GPT-4o',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
}

function modelLabel(id) {
  return MODEL_LABELS[id] ?? id ?? ''
}

export default function ModelMenu({ provider, onProviderChange, models, onModelChange, providerStatus, providerModels, onCredentialsSaved }) {
  const [open, setOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState(null)
  const [credFields, setCredFields] = useState({ account_id: '', api_token: '', api_key: '' })
  const [credError, setCredError] = useState('')
  const [credLoading, setCredLoading] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
        setEditingProvider(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const currentProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]
  const currentModel = models?.[provider]

  async function toggleEdit(providerId) {
    if (editingProvider === providerId) {
      setEditingProvider(null)
      return
    }
    setEditingProvider(providerId)
    setCredFields({ account_id: '', api_token: '', api_key: '' })
    setCredError('')
    setShowSecret(false)
    try {
      const current = await getApiKey(providerId)
      setCredFields({
        account_id: current.account_id ?? '',
        api_token: current.api_token ?? '',
        api_key: current.api_key ?? '',
      })
    } catch {
      // Fall back to a blank form if the lookup fails — the user can still type a new key.
    }
  }

  async function saveCreds(providerId) {
    setCredLoading(true)
    setCredError('')
    try {
      const payload = providerId === 'cloudflare'
        ? { provider: 'cloudflare', account_id: credFields.account_id.trim(), api_token: credFields.api_token.trim() }
        : { provider: providerId, api_key: credFields.api_key.trim() }
      await saveApiKey(payload)
      setEditingProvider(null)
      setCredFields({ account_id: '', api_token: '', api_key: '' })
      onCredentialsSaved?.()
    } catch (err) {
      setCredError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setCredLoading(false)
    }
  }

  function selectModel(providerId, modelId) {
    onModelChange(providerId, modelId)
    onProviderChange(providerId)
  }

  const credValid = (providerId) =>
    providerId === 'cloudflare'
      ? credFields.account_id.trim() && credFields.api_token.trim()
      : credFields.api_key.trim()

  return (
    <div className="model-menu" ref={wrapperRef}>
      <button className="model-menu-btn" onClick={() => setOpen((o) => !o)}>
        {currentProvider.label} · {modelLabel(currentModel)} ▾
      </button>
      {open && (
        <div className="model-menu-panel">
          {PROVIDERS.map((p) => {
            const ready = !!providerStatus?.[p.id]
            const modelOptions = providerModels?.[p.id] ?? []
            const isEditing = editingProvider === p.id
            return (
              <div key={p.id} className="model-menu-provider">
                <div className="model-menu-provider-header">
                  <span className="model-menu-provider-name">{p.label}</span>
                  <span className={ready ? 'mode-badge' : 'provider-badge-missing'}>
                    {ready ? 'configured' : 'not configured'}
                  </span>
                  <button className="model-menu-edit" onClick={() => toggleEdit(p.id)}>
                    {ready ? 'Edit key' : 'Add key'}
                  </button>
                </div>

                {modelOptions.length > 0 && (
                  <div className="provider-submodels">
                    {modelOptions.map((m) => (
                      <label key={m} className="check-toggle-label provider-submodel">
                        <input
                          type="radio"
                          name={`model-${p.id}`}
                          disabled={!ready}
                          checked={provider === p.id && currentModel === m}
                          onChange={() => selectModel(p.id, m)}
                        />
                        <span className="check-label-text">{modelLabel(m)}</span>
                      </label>
                    ))}
                  </div>
                )}

                {isEditing && (
                  <div className="model-menu-cred-form">
                    {p.id === 'cloudflare' ? (
                      <>
                        <input
                          type="text"
                          className="setup-input"
                          placeholder="Account ID"
                          value={credFields.account_id}
                          onChange={(e) => setCredFields((f) => ({ ...f, account_id: e.target.value }))}
                          spellCheck={false}
                        />
                        <div className="cred-input-row">
                          <input
                            type={showSecret ? 'text' : 'password'}
                            className="setup-input"
                            placeholder="API Token"
                            value={credFields.api_token}
                            onChange={(e) => setCredFields((f) => ({ ...f, api_token: e.target.value }))}
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            className="cred-toggle-visibility"
                            onClick={() => setShowSecret((s) => !s)}
                            title={showSecret ? 'Hide' : 'Show'}
                          >
                            {showSecret ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="cred-input-row">
                        <input
                          type={showSecret ? 'text' : 'password'}
                          className="setup-input"
                          placeholder="API Key"
                          value={credFields.api_key}
                          onChange={(e) => setCredFields((f) => ({ ...f, api_key: e.target.value }))}
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="cred-toggle-visibility"
                          onClick={() => setShowSecret((s) => !s)}
                          title={showSecret ? 'Hide' : 'Show'}
                        >
                          {showSecret ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    )}
                    {credError && <p className="setup-error">{credError}</p>}
                    <button
                      className="setup-btn"
                      disabled={credLoading || !credValid(p.id)}
                      onClick={() => saveCreds(p.id)}
                    >
                      {credLoading ? 'Validating…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
