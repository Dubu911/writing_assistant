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

---

## Feedback cards (right margin)

Cards live in a right-side panel with a light gray background (the writing area itself stays pure white) so the two zones are visually distinct.

### Card lifecycle

- **Collapsed (default):** shows only the *flag* — e.g. "Grammar issue", "Suggested rephrasing", "Word choice". No fix or explanation visible. The point is to let the writer think about the problem first.
- **Expanded (on click):** reveals the explanation and the suggested replacement(s).

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

FastAPI on `127.0.0.1:8000`. Model: `gemini-2.5-flash`.

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
    "types":          [...]    // line mode only
  }
  ```
  Returns `{ issues: [...] }`. Each issue: `id`, `text` (verbatim substring of `target`), `type`, `explanation`, `suggestions[]`.
- `POST /api/chat` — body: `{ session_id, message, context }`. Returns `{ reply }`. (Currently unused by UI; kept for future "ask about this" feature.)

The analyzer wraps the three text blocks in `<context_before>`, `<target>`, `<context_after>` tags and instructs the model to critique only what's inside `<target>`. Issues whose `text` does not appear verbatim in the target are dropped server-side.

Structure mode uses a different system prompt and default check list (flow, pacing, organization, transitions, coherence) and expects fewer, higher-level comments.

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
