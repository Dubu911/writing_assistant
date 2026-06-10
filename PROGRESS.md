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

---

## Open Issues

### 1. Migrate LLM backend: Gemini → Cloudflare Workers AI  *(top priority)*
**Problem:** Gemini's free tier on both `gemini-2.5-flash` AND `gemini-2.5-flash-lite` is capped at ~20 requests/day. A real auto-analyze writing session burns through that in minutes. Paying is not an option. Today's "switch to Flash-Lite" change did not actually solve this — both models share the same daily cap.

**Agreed approach:** Move LLM calls to **Cloudflare Workers AI** as the primary provider. Recommended models (in order):
1. `@cf/google/gemma-4-26b-a4b-it` — primary, higher quality
2. `@cf/meta/llama-3.1-8b-instruct-fp8-fast` — fallback, faster / cheaper neurons

**Why Cloudflare:** the only hosted free option whose limits comfortably exceed the workload (300 RPM, 10,000 neurons/day → ~450 calls/day on the 26B MoE model, ~600 on the 8B). Supports structured JSON output. No payment required.

**What this change touches:**
- `backend/analyzer.py` and `backend/chat.py` — replace `google-genai` client + model calls with Cloudflare Workers AI HTTP calls. Different SDK/REST shape, different auth (API token instead of API key), different response format. Keep `MODEL_NAME` in `config.py` as the single source of truth (model id format will be `@cf/...`).
- `backend/config.py` — `GEMINI_API_KEY` → `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. Two values, not one. Storage in `.env` stays the same idea.
- `backend/main.py` — `/api/setup` and `/api/status` need to accept and validate the new credential pair.
- `frontend/src/components/SetupScreen.jsx` — two input fields now (account id + token), help text pointing at the Cloudflare dashboard. Persona setting stays as-is.
- **Keep all the work done today** — sticky flags, per-(sentence, type) history, retry-until-success, persona, quota-vs-rate classifier. All of it is provider-agnostic and only touches request/response plumbing at the edges. The `isQuotaExhausted` matcher needs Cloudflare-specific strings added.

**Estimate:** ~1 focused session. Mostly mechanical replacement, but watch for: JSON Mode quirks (plan one repair-retry path), token-budget caps to keep output bounded, response_format schema differences vs Gemini.

**Verify before coding:** open the Cloudflare Workers AI docs and confirm (a) the exact model IDs above still exist, (b) the published free-tier neuron allowance, (c) the JSON Schema response_format syntax. Don't trust quoted limits without checking.

**Fallback plan if Cloudflare doesn't pan out:** local Ollama (`llama3.1:8b` or `qwen2.5:7b` Q4). Slower first-call, no quota ever, no data leaves the machine — matches the product principle. Requires user to install Ollama; treat as plan B.

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
**Defer until after** the Cloudflare migration — error strings will change shape, no point polishing the Gemini ones now.

---

### 4. LLM-assisted custom filter phrasing
**Problem:** When a user writes a custom check instruction, the wording directly affects LLM quality. Users shouldn't need to know prompt-engineering to get good results.
**Agreed approach:** Add a "Polish with AI" step in the ModeEditor check creation flow:
1. User types their intent in plain language (e.g. "flag sentences that are too casual for a thesis").
2. On save (or a dedicated button), send that description to a backend endpoint that asks the LLM to rewrite it as a precise, well-scoped instruction in the style of the existing built-in checks.
3. Show the polished version to the user for confirmation before saving — user can accept, edit, or discard.
**Files:** `ModeEditor.jsx` (UI for the polish step), `backend/main.py` (new `/api/polish-check` route), `backend/analyzer.py` or a new `backend/polish.py` (LLM call with a system prompt showing the existing check style as examples).
**Defer until after** the Cloudflare migration.

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
| LLM calls | `google-genai` (Gemini 2.5 Flash-Lite — to be replaced by Cloudflare Workers AI; see Open Issue #1) | `backend/analyzer.py`, `backend/chat.py` |
| Frontend | React 18 + Vite | `frontend/src/App.jsx` |
| Modes/state | localStorage | `frontend/src/modes.js` |
| API bridge | fetch via Vite proxy | `frontend/src/api.js` |
| Launch | `python start.py` | threads backend, foregrounds `npm run dev` |
