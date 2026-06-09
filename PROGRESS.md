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
- Auto-analyze silently reschedules on transient errors instead of showing raw error

---

## Open Issues

### 1. Issue deduplication on re-analysis
**Problem:** When auto-analyze re-fires (or user manually re-analyzes unchanged text), dismissed issues reappear as if new.  
**Agreed approach:** Deduplicate by `text + type` before setting state — if an issue with the same text span and type is already present in the current `issues` list, don't add it again. Do NOT do prompt-level history for now; deduplication is two lines and handles 80% of the annoyance.  
**Files:** `App.jsx` — the `.then()` handler in `runAnalysis` where `setIssues(found)` is called.

---

### 2. Raw API errors shown to the user
**Problem:** When the Gemini API returns an error (e.g. 503), the full raw Python exception string is shown in the status bar (e.g. `503 UNAVAILABLE. {'error': {'code': 503, ...}}`).  
**Agreed approach:**
- Show a short, friendly message to the user (e.g. "API error — check Advanced for details").
- Log the full error detail somewhere accessible but not intrusive — an "Advanced" expandable section, a separate dev panel, or a hidden log the user can open.
- The `cleanApiError()` helper in `App.jsx` already strips the raw blob for transient errors; extend this pattern to all errors.  
**Files:** `App.jsx` (`cleanApiError`, the catch block in `runAnalysis`), possibly a new small `ErrorLog` or `DevPanel` component.

---

### 3. LLM-assisted custom filter phrasing
**Problem:** When a user writes a custom check instruction, the wording directly affects LLM quality. Users shouldn't need to know prompt-engineering to get good results.  
**Agreed approach:** Add a "Polish with AI" step in the ModeEditor check creation flow:
1. User types their intent in plain language (e.g. "flag sentences that are too casual for a thesis").
2. On save (or a dedicated button), send that description to a backend endpoint that asks Gemini to rewrite it as a precise, well-scoped instruction in the style of the existing built-in checks.
3. Show the polished version to the user for confirmation before saving — user can accept, edit, or discard.  
**Files:** `ModeEditor.jsx` (UI for the polish step), `backend/main.py` (new `/api/polish-check` route), `backend/analyzer.py` or a new `backend/polish.py` (Gemini call with a system prompt showing the existing check style as examples).

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
| LLM calls | `google-genai` (Gemini 2.5 Flash) | `backend/analyzer.py`, `backend/chat.py` |
| Frontend | React 18 + Vite | `frontend/src/App.jsx` |
| Modes/state | localStorage | `frontend/src/modes.js` |
| API bridge | fetch via Vite proxy | `frontend/src/api.js` |
| Launch | `python start.py` | threads backend, foregrounds `npm run dev` |
