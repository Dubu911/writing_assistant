# Writing Assistant — Design Spec

A local desktop writing tool that helps a writer edit their own work without losing their voice. The model gets surrounding context for understanding flow, but only critiques the passage the writer is actively focused on.

This document captures design decisions agreed with the user. Treat it as the source of truth for *intent*; the code is the source of truth for *current implementation*. Update this file when intent changes.

---

## Product principles

1. **Editor metaphor.** Behave like a careful human editor: read enough context to understand the flow, but only mark up the passage the writer points at.
2. **Writer-driven, not always-on.** Feedback is triggered by the user, not streamed continuously. The writer decides when to ask.
3. **Surface the flag, hide the answer.** Feedback first shows *that* there is an issue and *what kind*. The fix is one click away. The writer should get a chance to think first.
4. **Minimal chrome.** The writing surface is white and uncluttered. Feedback lives in a separate right margin.

---

## Modes

A mode button toggles between two distinct editing experiences.

### Line mode (default)
Sentence-level feedback: grammar, word choice, clarity, phrasing.

- Writing area shows a **focus window** delimited by two pastel dotted horizontal lines (e.g. `- - - - - -`).
- The focus window is purely visual until the user triggers analyze — no scroll-time computation.
- Default position: roughly the top 10% to 60% of the viewport.
- Both dotted lines are draggable; the user can shrink the window to a single paragraph or expand it to fill the screen.
- The focus window's position is captured **only at analyze time**. Scrolling, typing, and hovering do not trigger work.

### Structure mode
Higher-altitude feedback: argument flow, pacing, organization, section-level coherence.

- The dotted focus window disappears.
- The user **selects/highlights** the text range they want structural feedback on (a section, a chapter, or the whole document).
- Triggering analyze sends that selection with a different prompt that explicitly asks for structural feedback and not sentence-level nitpicks.
- Feedback still appears in the right margin, but cards are fewer and longer.

---

## Analyze trigger

- **Button** in the UI, plus **Shift+Enter** hotkey. Both do the same thing.
- On trigger:
  1. Determine the **target text** (focus window in line mode; selection in structure mode).
  2. Grab a modest chunk of **surrounding text as read-only context**.
  3. Send one API call to the backend.
  4. Render returned feedback cards in the right margin.

### Target vs. context

- **Target** is the only text the model is allowed to critique or rewrite.
- **Context** is sent as reference material so the model understands flow, pronoun referents, and continuity. The prompt explicitly forbids flagging anything inside the context block.
- **Default context size:** ~500 words before + ~500 words after the target, capped at document boundaries. Tunable later. The user does not need to manage this.

### Incomplete-sentence rule (line mode)

If a sentence is only partially inside the focus window (its start or end falls outside the dotted lines), **do not flag it**. The full sentence is needed to judge it fairly. The clean rule: only flag sentences fully contained within the focus window.

### Auto-analyze and retries

Auto mode debounces 10s from the first edit and fires one call per "burst of typing." The contract: **every edit must eventually produce at least one successful feedback round.** Concretely:

- On every edit, a `dirty` flag is set. It clears only when an analyze call returns successfully.
- If a call fails with a *transient* error (503, 429, UNAVAILABLE, RESOURCE_EXHAUSTED) while `dirty` is still true and auto is on, the next attempt is rescheduled with exponential backoff: 10s → 20s → 40s (capped). The status bar shows the countdown.
- **Daily-quota exhaustion is treated separately from per-minute rate limits.** A `Quota exceeded` / `free_tier_requests` / `per day` error string tells us the quota won't recover from a 10–40s backoff — it resets at midnight Pacific. In that case we clear `dirty`, cancel the retry chain, and show a distinct message ("Daily Gemini free quota exhausted — resets at midnight Pacific.") instead of pointlessly burning more attempts.
- The retry counter resets to zero on any successful response or when auto is toggled off.
- Hard errors (auth, malformed request) skip the retry path and surface immediately.

This means the user cannot end up in a state where they typed, the API was momentarily busy, and the system silently gave up. Typing more does not stack retries — the existing retry chain continues, the new edit just keeps `dirty` true.

---

## Feedback cards (right margin)

Cards live in a right-side panel with a light gray background (the writing area itself stays pure white) so the two zones are visually distinct.

### Card lifecycle

- **Collapsed (default):** shows only the *flag* — e.g. "Grammar issue", "Suggested rephrasing", "Word choice". No fix or explanation visible. The point is to let the writer think about the problem first.
- **Expanded (on click):** reveals the explanation and the suggested replacement(s).

### Sticky flags

A flag must not vanish before the writer has a chance to see it — especially in auto-analyze mode, where a new call may fire 10s after the last. Rule:

- An issue stays on screen until the user **acknowledges** it: opens the card, applies a suggestion, or edits the underlying sentence away.
- Each new analyze result is **merged** with the unacknowledged issues already on screen, deduped by `(containing-sentence, type)`. The model often rephrases span boundaries between calls — keying on the host sentence prevents that from spawning duplicate cards for the same logical issue. Falls back to `(text, type)` when a span doesn't map cleanly to one sentence. New issues are added; unacknowledged old issues are preserved as long as their `text` still appears in the current target.
- Acknowledged issues are dropped on the next analyze and not re-added (the model's `<prior_reviews>` block tells it not to re-flag them).
- A side effect: if the model stops flagging something the user ignored, the card persists until the user clicks it. That's intentional — preferred over silently losing a flag.

### Card interactions

- **Hover the flagged sentence in the document** → the corresponding margin card highlights.
- **Hover a margin card** → the flagged sentence in the document highlights.
- **Click a margin card** → it expands to show the full feedback.

### Card alignment

Cards align vertically to the line of their target sentence in the document.

---

## Visual treatment

- Writing area: **pure white**, full editable surface.
- Right margin panel: **light gray** background, holds feedback cards. Visually separated from the writing area.
- Focus window markers: **pastel dotted horizontal lines** across the writing area, draggable.
- Outside the focus window (line mode): plain text — no dimming, no blur, just unmarked.

---

## Persistence

For now, keep it simple. Persistence will grow as the product does. Specifics will be added as we go.

---

## Window / packaging

- **Now (development):** runs in the browser at `http://localhost:5173`. The user alt-tabs by opening it in a separate browser window. No wrapper code yet.
- **Eventually:** ship as a single downloadable `.exe` so end users don't have to install Python, Node, or run any setup. Likely paths: Tauri (lighter) or Electron (more familiar). Decision deferred until the core UX is settled.

---

## Current backend surface

FastAPI on `127.0.0.1:8000`. Model: `gemini-2.5-flash-lite` (centralised in `backend/config.py` as `MODEL_NAME`).

The model was switched from `gemini-2.5-flash` to `flash-lite` because Google's free tier caps Flash at ~20 requests/day, which an auto-analyze writing session burns through in minutes. Flash-Lite has a much higher free daily quota. Trade-off: noticeably weaker on nuanced critique (tone, structural feedback). Acceptable for the line-mode grammar/clarity workflow the product centres on; structure mode quality is lower than it was on Flash.

- `GET  /api/status` — returns whether an API key is configured.
- `POST /api/setup` — saves the user's Gemini API key.
- `POST /api/analyze` — body:
  ```
  {
    "target":         "<text to critique>",
    "context_before": "<read-only background>",
    "context_after":  "<read-only background>",
    "mode":           "line" | "structure",
    "instructions":   "...",   // line mode only
    "types":          [...],   // line mode only
    "history":        [...],   // line mode only; see "Revision memory" below
    "persona":        "..."    // see "Persona" below; empty = neutral default
  }
  ```
  Returns `{ issues: [...] }`. Each issue: `id`, `text` (verbatim substring of `target`), `type`, `explanation`, `suggestions[]`.
- `POST /api/chat` — body: `{ session_id, message, context, persona }`. Returns `{ reply }`. (Currently unused by UI; kept for future "ask about this" feature.)

The analyzer wraps the three text blocks in `<context_before>`, `<target>`, `<context_after>` tags and instructs the model to critique only what's inside `<target>`. Issues whose `text` does not appear verbatim in the target are dropped server-side.

Structure mode uses a different system prompt and default check list (flow, pacing, organization, transitions, coherence) and expects fewer, higher-level comments.

---

## Persona

A single line describing who the model should pretend to be. Lives in `localStorage` (`wa_persona`), persists across sessions, edited in the Settings panel inside the mode editor (gear button). Sent on every `/api/analyze` and `/api/chat` call.

- **Empty (default).** Backend uses a neutral opener: *"You are a writing assistant reviewing the user's writing."* (or the structural-editor variant in structure mode). No PhD or non-native assumptions.
- **Set.** Backend uses *"You are {persona}."* — the user-set line **fully replaces** the opener. Nothing is appended on top. If the user wants the model to know they're a non-native speaker editing a PhD thesis, they put it in the persona; we don't sneak it in.

This was added because the old hardcoded *"writing assistant for a non-native English speaker pursuing a PhD"* opener was biasing the model toward academic-register feedback (e.g. flagging *"gets rid of"* as too informal) even when the user's mode was set to "grammar only." The persona setting decouples mode (what to flag) from voice (who the editor is).

---

## Revision memory (line mode)

Stateless LLM calls cause two bad failure modes the user actually hits:
1. **Flip-flop:** same sentence is flagged in one call, judged fine in the next.
2. **Goalpost shifting:** user applies suggestion A, the sentence changes, and the next call suggests B on the new sentence — endlessly.

To dampen this, the frontend tracks a session-only `sentenceHistory` map: `sentence text → Map<type, { mode, modeId, flag, action, suggestion }>`. **One slot per (sentence, type)**, not per sentence — a sentence flagged for both clarity and word_choice carries both judgments forward, so neither dimension gets re-rolled silently the next call. On every analyze:

- For each sentence still present verbatim in the target, the frontend iterates the inner per-type map and emits one history entry per slot whose `type` is in the current request's `types`. (Types the user has turned off this round are excluded — the model is free to look at them fresh.)
- The backend appends a `<prior_reviews>` block to the user payload that lists those sentences and tells the model: *prefer silence over marginal repeat suggestions; only re-flag if clearly still broken.*

Key invariants:
- **Edited sentence ⇒ fresh evaluation.** Because the outer key is the sentence text, any edit makes the old key fail to match the new target and history drops out automatically. (`handleApply` re-keys the entire per-type map under the post-edit sentence text so accepted-type slots survive the edit and continue to inform the next call.)
- **Criteria change ⇒ fresh evaluation per dimension.** Switching modes (basic ↔ advanced, custom mode swap) changes the active `types`; per-type slots whose type isn't in the new set are simply not sent that round. The data isn't discarded — if the user switches back, those judgments re-engage.
- **History length is 1 per (sentence, type)** (last judgment only). Increasing the length doesn't help with flip-flopping; the fix is the per-type slot, not depth. Bump only if we ever want the model to see suggestion-revert trails over multiple revisions.

A second, cheap belt-and-suspenders filter dedupes the response on the client by `(text, type)` against issues already on screen, so accidental repeats from the same call don't surface twice.

The `action` field is `"flagged"` when the model raised an issue, and `"accepted"` once the user clicks a suggestion. There is no explicit "dismiss" action — a sentence the user leaves alone keeps `action: "flagged"`, which produces the strongest "don't re-flag" instruction to the model.

Structure mode does not use history (the targets are too coarse-grained for sentence-keyed memory to help).

---

## Frontend structure

```
frontend/src/
  api.js                  — backend client
  App.jsx / App.css       — root (workspace shell, mode toggle, Shift+Enter)
  main.jsx                — entrypoint
  modes.js                — line-mode check definitions / prompt assembly
  components/
    Editor.jsx            — contenteditable; paragraphs-as-<p>; snapshot capture
    FocusBand.jsx         — two viewport-fixed draggable pastel dotted lines
    FeedbackPanel.jsx     — right-margin card list, absolutely positioned to align with text
    ModeEditor.jsx        — line-mode check editor (unchanged from before)
    SetupScreen.jsx       — API key entry
```

### How the focus snapshot works (line mode)

At analyze time, `Editor.captureSnapshot()` walks every `<p data-p>` in the document, intersects each rectangle with the focus band, and partitions paragraphs into `beforeFocus / inFocus / afterFocus`. The focus text is then trimmed to whole sentences (drops any leading partial up to the first capital letter; drops any trailing partial after the last `.`/`!`/`?`). Context is the last ~500 words before and first ~500 words after.

In structure mode the user's text selection is the target; context is ~500 words on either side of the selection.

---

## Out of scope (for now)

- Real-time / streaming feedback.
- Multi-document project management.
- Accept/reject UI for individual suggestions (cards are read-only for v1).
- Auto-summarization or chunking of very long documents — modern model context windows are large enough that this is unnecessary at the scale a single writer works at.
- Standalone window packaging (Tauri/Electron) — deferred until UX is settled.

---

## Open questions / future decisions

- Exact context size — start at ±500 words, tune by feel.
- Whether to detect section boundaries (headings, blank lines) and clip context there instead of by word count.
- Whether structure mode should also accept "the whole document" as a one-click target, separate from manual selection.
- Eventual packaging choice (Tauri vs. Electron vs. PWA install).
