# Project Progress

Working notes for development. Update this file when finishing or discovering work.

---

## Current Status

Core app is functional end-to-end:
- Focus band, line analysis, structure analysis all working
- Custom modes with check templates, fully editable and persisted to localStorage
- Issue highlights synced to feedback cards in the right panel
- Chat per issue (session-based, in-memory)
- Auto-analyze mode (10 s throttle from first edit, respects Gemini free-tier 10 RPM)
- Backend retry logic for transient 503/429 Gemini errors (2 retries: 5 s, 10 s)
- Auto-analyze **retries until success** on transient errors while there are unfed-back edits: `dirty` flag set on edit, cleared on successful response; backoff 10s → 20s → 40s. Daily-quota exhaustion is detected separately and stops the retry chain with a clear message (won't recover from short backoff — resets midnight PT). See "Auto-analyze and retries" in CLAUDE.md.
- **Model changed: `gemini-2.5-flash` → `gemini-2.5-flash-lite`** to escape the Flash free-tier daily cap (~20 req/day). Centralised in `backend/config.py:MODEL_NAME`. Quality trade-off noted in CLAUDE.md.
- **Persona setting**: user-configurable one-line description of who the model should pretend to be. Stored in localStorage (`wa_persona`), persists across sessions, edited in a new Settings panel inside the mode editor. Empty default uses a neutral opener; set value fully replaces the old hardcoded "PhD / non-native" line. Decouples filter (mode) from voice (persona). See "Persona" in CLAUDE.md.
- **Sticky flags**: an issue stays on screen until the user opens it, applies it, or edits the sentence away. New analyses merge with on-screen issues instead of replacing them. See "Sticky flags" in CLAUDE.md.
- **Sentence revision memory** (line mode): per-(sentence, type) judgment history sent with each analyze call so the LLM doesn't flip-flop on unchanged text or shift goalposts after a fix. Multiple flag types on the same sentence each carry their own slot. Session-only, criteria-scoped, length-1 per `(sentence, type)`. See "Revision memory" in CLAUDE.md.
- **Dual LLM provider with swap**: Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fp8`) is now the default provider; Gemini (`gemini-2.5-flash-lite`) is kept available as a one-click secondary via the new "Model Provider" Settings page. `backend/cf_client.py` and `backend/gemini_client.py` expose the same `call_*(…, json_mode, max_tokens, temperature)` signature; `analyzer.py`/`chat.py` dispatch on a per-request `provider` field. `/api/status` now returns `{ configured, providers: { cloudflare, gemini } }`. See "Model provider" and "Current backend surface" in CLAUDE.md.
- **4-provider Model menu + onboarding gate removed**: added OpenAI (`backend/openai_client.py`, `gpt-4o-mini`/`gpt-4o`) and Anthropic (`backend/anthropic_client.py`, `claude-haiku-4-5-20251001`/`claude-sonnet-4-6`) as swappable providers, plus a Cloudflare 70B option (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`). All 4 providers + their model lists live in `PROVIDER_MODELS` (`backend/config.py`), exposed via `/api/status`'s new `models` field. A new top-left **Model menu** (`frontend/src/components/ModelMenu.jsx`) replaces the old gear-icon "Model Provider" tab: pick provider+model via radios (sourced from `/api/status`, never hardcoded), and add/edit any provider's API key inline via `/api/setup` at any time — not just first run. `wa_gemini_model` localStorage key was replaced by a generic `wa_models` map (one model id per provider), with a one-time migration. The `gemini_model` request field became generic `model` on `/api/analyze`/`/api/chat`. `SetupScreen.jsx` and the onboarding gate are gone — the app always opens to the editor; if zero providers are configured, a `.config-banner` above the header points at the Model menu. See "Model menu" and "Current backend surface" in CLAUDE.md.
  - **Caveat to verify with real keys**: the OpenAI/Anthropic/Cloudflare-70B model ids in `PROVIDER_MODELS` were chosen from current naming conventions but not live-tested against paid accounts yet. `/api/setup`'s live validation call will surface a clear "Invalid API key" or model-not-found error immediately if any id is stale — a one-line fix in `backend/config.py` if so.
  - **Update**: cloudflare/gemini/openai model ids verified live against real keys via `/api/analyze` (all 3 returned valid responses or real provider errors); `anthropic` still unconfigured/unverified.
- **View/copy stored API keys**: the Model menu's "Edit key" form now pre-fills with the currently-stored credential (via new `GET /api/credentials/{provider}` → `get_provider_credentials` in `backend/config.py`) behind a "Show"/"Hide" toggle, so the user can copy a key already configured on this machine to set up the app elsewhere. See "Model menu" and "Current backend surface" in CLAUDE.md.

---

## Open Issues

### 1. ~~Migrate LLM backend: Gemini → Cloudflare Workers AI~~ — DONE (as dual-provider)
**Was:** Gemini's free tier on both `gemini-2.5-flash` AND `gemini-2.5-flash-lite` is capped at ~20 requests/day. A real auto-analyze writing session burns through that in minutes.

**Resolved by:** Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fp8`, ~10,000 neurons/day, resets midnight UTC) is now the **default** provider, reached via `backend/cf_client.py: call_cloudflare`. Rather than fully removing Gemini, it's kept as a **swappable secondary provider** (`backend/gemini_client.py: call_gemini`, `gemini-2.5-flash-lite`) — the user picks the active provider per-request from the new "Model Provider" Settings page (gear icon), and the choice is sent as `provider` on every `/api/analyze`/`/api/chat` call. `/api/status` now reports `{ configured, providers: { cloudflare, gemini } }` so the Settings page can show which providers are usable.

All prior work — sticky flags, per-(sentence, type) revision memory, retry-until-success, persona, quota-vs-rate classifier — is unchanged and works identically regardless of which provider is active; `_is_transient`/`isTransientError`/`isQuotaExhausted`/`cleanApiError` now match both providers' error vocabularies. See "Model provider" and "Current backend surface" in CLAUDE.md.

**Open follow-ups:**
- ~~fp8 JSON-mode reliability~~ — RESOLVED. JSON-mode itself works fine on `@cf/meta/llama-3.1-8b-instruct-fp8` (the model wraps `{...}` in a "Here is the JSON object..." preamble + ` ``` ` fences, which `_parse_json_response`'s repair pass already strips). The real bug was that `analyze_text` called `call_cloudflare(...)` with no `max_tokens`, so Cloudflare's **default cap of 256 completion tokens** truncated the JSON mid-string before it could close — no repair pass can recover an unclosed object. Fixed by passing `max_tokens=2048` explicitly for both providers in `analyzer.py`. Verified live: a 3-issue response used 337/2048 tokens and parsed cleanly.
- **Exact Cloudflare daily-neuron-exhaustion error string** is unconfirmed — `isQuotaExhausted` in `App.jsx` uses best-effort matches (`neuron`, `exceeded the daily`, `daily limit`, `quota exceeded`). Tune once the daily cap is actually hit.

---

### 2. ~~Issue deduplication on re-analysis~~ — DONE
**Was:** When auto-analyze re-fires, dismissed issues reappear as if new; LLM also flip-flops on unchanged text and shifts goalposts after fixes.
**Resolved by:** per-(sentence, type) revision memory + sticky-flag merge (issues persist until user opens / applies / edits). Frontend tracks judgments in `sentenceHistoryRef` keyed by sentence text → `Map<type, judgment>`; sends a filtered `history` array with each analyze call; `analyzer.py` injects a `<prior_reviews>` block into the prompt. Edited sentences and criteria changes invalidate history automatically. See CLAUDE.md → "Revision memory (line mode)" and "Sticky flags".

---

### 3. Raw API errors shown to the user
**Problem:** When the API returns an error (e.g. 503), the full raw Python exception string is shown in the status bar (e.g. `503 UNAVAILABLE. {'error': {'code': 503, ...}}`).
**Status:** Partly mitigated today — `cleanApiError()` strips the worst of it, transient errors get retried silently in auto mode, and daily-quota exhaustion shows a friendly message instead of the raw blob. Still missing: an expandable "Advanced" view to inspect the full error when needed.
**Agreed approach:**
- Keep the short, friendly message in the status bar.
- Add an "Advanced" expandable section (or small dev panel) where the full last-error blob is accessible.
**Files:** `App.jsx` (`cleanApiError`, the catch block in `runAnalysis`), possibly a new small `ErrorLog` or `DevPanel` component.
**Status:** still deferred — lower priority than other open work.

---

### 4. LLM-assisted custom filter phrasing
**Problem:** When a user writes a custom check instruction, the wording directly affects LLM quality. Users shouldn't need to know prompt-engineering to get good results.
**Agreed approach:** Add a "Polish with AI" step in the ModeEditor check creation flow:
1. User types their intent in plain language (e.g. "flag sentences that are too casual for a thesis").
2. On save (or a dedicated button), send that description to a backend endpoint that asks the LLM to rewrite it as a precise, well-scoped instruction in the style of the existing built-in checks.
3. Show the polished version to the user for confirmation before saving — user can accept, edit, or discard.
**Files:** `ModeEditor.jsx` (UI for the polish step), `backend/main.py` (new `/api/polish-check` route), `backend/analyzer.py` or a new `backend/polish.py` (LLM call with a system prompt showing the existing check style as examples).
**Status:** still deferred — lower priority than other open work.

---

## Deferred / Nice-to-Have

- Correction history: track dismissed issues in a session so the LLM doesn't re-flag them (decided: do deduplication first, revisit if needed)
- Persist chat sessions across backend restarts
- Export / import custom modes as JSON
- Keyboard shortcut to jump to next/previous issue
- Dark mode

---

## Architecture Quick Reference

| Layer | Tech | Entry point |
|---|---|---|
| Backend | FastAPI + uvicorn | `backend/main.py` |
| LLM calls | Cloudflare Workers AI (default) + `google-genai` (Gemini, swappable secondary) | `backend/cf_client.py`, `backend/gemini_client.py`, dispatched from `backend/analyzer.py`, `backend/chat.py` |
| Frontend | React 18 + Vite | `frontend/src/App.jsx` |
| Modes/state | localStorage | `frontend/src/modes.js` |
| API bridge | fetch via Vite proxy | `frontend/src/api.js` |
| Launch | `python start.py` | threads backend, foregrounds `npm run dev` |
