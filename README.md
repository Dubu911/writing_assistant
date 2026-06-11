# Writing Assistant

A local AI writing tool for PhD writing. Paste or type your text, position the focus band over the paragraph you want reviewed, and press **Shift+Enter** to get inline suggestions. Supports four LLM providers — **Cloudflare Workers AI** (default, free), **Google Gemini**, **OpenAI**, and **Anthropic (Claude)** — switchable any time from the Model menu.

---

## Features

- **Focus band** — two draggable lines mark the active zone; only text inside is analyzed
- **Line mode** — sentence-level feedback: grammar, clarity, passive voice, tone, conciseness, word choice, and more
- **Structure mode** — paragraph-level feedback on argument flow, pacing, organization, transitions, and coherence
- **Inline highlights** — issues are underlined in the editor; hover or click to see the card
- **Suggestions** — click a suggestion to apply it directly in the editor
- **Chat** — ask follow-up questions about any flagged issue (why is this wrong? what does this word mean?)
- **Custom modes** — build your own check sets from templates or write your own instructions
- **Auto-analyze** — toggle the header button from Manual → Auto; analysis fires 10 s after the first edit in each window
- **Model menu** — top-left header button to pick the active provider and model, and to add/edit API keys for any of the four providers at any time; each analyze/chat call goes to whichever provider+model is currently selected. The "Edit key" form pre-fills with your currently-stored key (behind a Show/Hide toggle) so you can copy it to set up the app on another machine

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- At least one of:
  - A [Cloudflare](https://dash.cloudflare.com/) account ID and a Workers AI-scoped API token (default provider, free tier)
  - A [Google AI Studio](https://aistudio.google.com/app/apikey) API key (Gemini)
  - An [OpenAI](https://platform.openai.com/api-keys) API key
  - An [Anthropic](https://console.anthropic.com/settings/keys) API key

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

The app opens straight to the editor. Click the **Model menu** (top-left) to add an API key for any provider — keys are validated live and saved to `.env`. If no provider is configured yet, a banner above the header reminds you to add one. Switch providers/models any time from the same menu; the choice is saved in your browser and used on the next analyze/chat call.

---

## Project Structure

```
writing_assistant/
├── start.py                  # launches backend + frontend together
├── requirements.txt
├── .env                      # CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
├── backend/
│   ├── main.py               # FastAPI app, routes
│   ├── analyzer.py           # analyze_text(), dispatches to the 4 provider clients
│   ├── chat.py                # per-session chat with issue context, same dispatch
│   ├── cf_client.py           # Cloudflare Workers AI REST wrapper
│   ├── gemini_client.py       # Gemini SDK wrapper, same call signature
│   ├── openai_client.py       # OpenAI SDK wrapper, same call signature
│   ├── anthropic_client.py    # Anthropic SDK wrapper, same call signature
│   └── config.py              # PROVIDER_MODELS + credential load/save for all 4 providers via python-dotenv
└── frontend/
    └── src/
        ├── App.jsx            # top-level state, auto-analyze, header
        ├── App.css
        ├── api.js             # fetch helpers
        ├── modes.js           # built-in + custom modes, persona, provider/model — localStorage persistence
        └── components/
            ├── Editor.jsx     # contenteditable, focus-band capture, issue marks
            ├── FocusBand.jsx  # draggable viewport-fixed lines
            ├── FeedbackPanel.jsx  # issue cards, vertically synced to text
            ├── ModeEditor.jsx # create / edit custom check modes; Settings (persona)
            └── ModelMenu.jsx  # top-left provider/model picker + inline credential forms
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| **Shift+Enter** | Run analysis (works anywhere on the page) |

---

## Notes

- API credentials are stored in `.env` at the project root. Never commit this file.
- Chat sessions reset when the backend restarts (in-memory only).
- Custom modes, persona, and the active model provider/model are saved to browser `localStorage`.
