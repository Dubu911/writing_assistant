# Writing Assistant

A local AI writing tool for PhD writing. Paste or type your text, position the focus band over the paragraph you want reviewed, and press **Shift+Enter** to get inline suggestions from Google Gemini.

---

## Features

- **Focus band** — two draggable lines mark the active zone; only text inside is analyzed
- **Line mode** — sentence-level feedback: grammar, clarity, passive voice, tone, conciseness, word choice, and more
- **Structure mode** — paragraph-level feedback on argument flow, pacing, organization, transitions, and coherence
- **Inline highlights** — issues are underlined in the editor; hover or click to see the card
- **Suggestions** — click a suggestion to apply it directly in the editor
- **Chat** — ask follow-up questions about any flagged issue (why is this wrong? what does this word mean?)
- **Custom modes** — build your own check sets from templates or write your own instructions
- **Auto-analyze** — toggle the header button from Manual → Auto; analysis fires 10 s after the first edit in each window (stays under Gemini free-tier rate limits)

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/app/apikey) API key (Gemini 2.5 Flash)

---

## Setup

```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Install frontend dependencies
cd frontend && npm install && cd ..
```

---

## Running

```bash
python start.py
```

This starts the FastAPI backend on `http://localhost:8000` and the Vite frontend on `http://localhost:5173`, then opens your browser automatically.

On the first run you will be prompted to enter your Gemini API key. It is validated against the API and saved to `.env` — you will not be asked again.

---

## Project Structure

```
writing_assistant/
├── start.py                  # launches backend + frontend together
├── requirements.txt
├── .env                      # GEMINI_API_KEY (auto-created on first run)
├── backend/
│   ├── main.py               # FastAPI app, routes
│   ├── analyzer.py           # Gemini analyze_text(), line + structure modes
│   ├── chat.py               # per-session chat with issue context
│   └── config.py             # API key load/save via python-dotenv
└── frontend/
    └── src/
        ├── App.jsx            # top-level state, auto-analyze, header
        ├── App.css
        ├── api.js             # fetch helpers
        ├── modes.js           # built-in + custom modes, localStorage persistence
        └── components/
            ├── Editor.jsx     # contenteditable, focus-band capture, issue marks
            ├── FocusBand.jsx  # draggable viewport-fixed lines
            ├── FeedbackPanel.jsx  # issue cards, vertically synced to text
            ├── ModeEditor.jsx # create / edit custom check modes
            └── SetupScreen.jsx
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **Shift+Enter** | Run analysis (works anywhere on the page) |

---

## Notes

- The API key is stored in `.env` at the project root. Never commit this file.
- Chat sessions reset when the backend restarts (in-memory only).
- Custom modes are saved to browser `localStorage`.
