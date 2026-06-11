// modes.js — all mode/check definitions and localStorage persistence

const STORAGE_KEY   = 'wa_custom_modes'
const PERSONA_KEY   = 'wa_persona'
const PROVIDER_KEY  = 'wa_provider'
const MODELS_KEY    = 'wa_models'
const LEGACY_GEMINI_MODEL_KEY = 'wa_gemini_model'

const DEFAULT_MODELS = {
  cloudflare: '@cf/meta/llama-3.1-8b-instruct-fp8',
  gemini: 'gemini-2.5-flash-lite',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
}

// Check templates users can pick from when building a custom mode
export const CHECK_TEMPLATES = [
  { templateId: 'grammar',     label: 'Grammar',          type: 'grammar',     instruction: 'Flag grammatical errors: subject-verb agreement, article usage (a/an/the), verb tense, plural/singular, and prepositions.' },
  { templateId: 'clarity',     label: 'Clarity',          type: 'clarity',     instruction: 'Flag unclear or ambiguous sentences where the intended meaning is not immediately obvious to the reader.' },
  { templateId: 'passive',     label: 'Passive Voice',    type: 'passive',     instruction: 'Flag passive voice constructions where switching to active voice would make the sentence clearer and more direct.' },
  { templateId: 'tone',        label: 'Academic Tone',    type: 'tone',        instruction: 'Flag informal language, contractions, or casual expressions that are inappropriate for academic or technical writing.' },
  { templateId: 'conciseness', label: 'Conciseness',      type: 'conciseness', instruction: 'Flag wordy or redundant phrases (e.g. "due to the fact that", "in order to") and suggest more concise alternatives.' },
  { templateId: 'word_choice', label: 'Word Choice',      type: 'word_choice', instruction: 'Flag weak, vague, or imprecise word choices and suggest stronger, more specific alternatives.' },
  { templateId: 'length',      label: 'Sentence Length',  type: 'length',      instruction: 'Flag sentences exceeding 35 words that would be clearer if split into two shorter sentences.' },
  { templateId: 'hedging',     label: 'Hedging Language', type: 'hedging',     instruction: "Flag excessive hedging expressions (might, could, perhaps, it seems, it appears, arguably) that unnecessarily weaken the argument's confidence." },
  { templateId: 'transitions', label: 'Transitions',      type: 'transitions', instruction: 'Flag abrupt transitions between sentences or ideas where a smoother connector or linking phrase would improve flow.' },
]

// Built-in modes are always present and cannot be deleted or renamed
export const BUILTIN_MODES = [
  {
    id: 'basic',
    name: 'Basic',
    builtin: true,
    checks: [
      { id: 'b_g', ...CHECK_TEMPLATES[0], enabled: true },
    ],
  },
  {
    id: 'academic',
    name: 'Academic',
    builtin: true,
    checks: [
      { id: 'a_g',  ...CHECK_TEMPLATES[0], enabled: true },
      { id: 'a_cl', ...CHECK_TEMPLATES[1], enabled: true },
      { id: 'a_p',  ...CHECK_TEMPLATES[2], enabled: true },
      { id: 'a_t',  ...CHECK_TEMPLATES[3], enabled: true },
    ],
  },
  {
    id: 'advanced',
    name: 'Advanced',
    builtin: true,
    checks: [
      { id: 'adv_g',  ...CHECK_TEMPLATES[0], enabled: true },
      { id: 'adv_cl', ...CHECK_TEMPLATES[1], enabled: true },
      { id: 'adv_p',  ...CHECK_TEMPLATES[2], enabled: true },
      { id: 'adv_t',  ...CHECK_TEMPLATES[3], enabled: true },
      { id: 'adv_co', ...CHECK_TEMPLATES[4], enabled: true },
      { id: 'adv_w',  ...CHECK_TEMPLATES[5], enabled: true },
    ],
  },
]

export function loadCustomModes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch { return [] }
}

export function saveCustomModes(modes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(modes))
}

// Persona — a one-line description of who the model should pretend to be.
// Empty string = neutral writing assistant (backend default). Persists across
// browser sessions.
export function loadPersona() {
  try { return localStorage.getItem(PERSONA_KEY) ?? '' }
  catch { return '' }
}

export function savePersona(persona) {
  localStorage.setItem(PERSONA_KEY, persona)
}

// Provider — which LLM backend serves /api/analyze and /api/chat.
// "cloudflare" (default, primary) or "gemini" (secondary, swappable).
// Persists across browser sessions.
export function loadProvider() {
  try { return localStorage.getItem(PROVIDER_KEY) ?? 'cloudflare' }
  catch { return 'cloudflare' }
}

export function saveProvider(provider) {
  localStorage.setItem(PROVIDER_KEY, provider)
}

// Models — per-provider model id map for /api/analyze and /api/chat, e.g.
// { cloudflare: '...', gemini: '...', openai: '...', anthropic: '...' }.
// Persists across browser sessions. Falls back to a one-time read of the
// legacy single-provider Gemini key.
export function loadModels() {
  try {
    const stored = JSON.parse(localStorage.getItem(MODELS_KEY) || '{}')
    const legacyGemini = localStorage.getItem(LEGACY_GEMINI_MODEL_KEY)
    if (legacyGemini && !stored.gemini) stored.gemini = legacyGemini
    return { ...DEFAULT_MODELS, ...stored }
  } catch { return { ...DEFAULT_MODELS } }
}

export function saveModel(provider, modelId) {
  const next = { ...loadModels(), [provider]: modelId }
  localStorage.setItem(MODELS_KEY, JSON.stringify(next))
}

export function getAllModes() {
  return [...BUILTIN_MODES, ...loadCustomModes()]
}

export function getModeById(id) {
  return getAllModes().find((m) => m.id === id) ?? BUILTIN_MODES[0]
}

/**
 * Assemble the prompt instructions and type list from a mode's enabled checks.
 * This string goes directly into the LLM system prompt.
 */
export function assembleMode(mode) {
  const enabled = mode.checks.filter((c) => c.enabled)
  if (enabled.length === 0) {
    return { instructions: 'Flag obvious grammatical errors only.', types: ['grammar'] }
  }
  const instructions = enabled
    .map((c, i) => `${i + 1}. [${c.label}] ${c.instruction}`)
    .join('\n')
  const types = [...new Set(enabled.map((c) => c.type))]
  return { instructions, types }
}
