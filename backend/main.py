import sys
import os

# Make sure Python finds config/analyzer/chat as sibling modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from config import (
    save_cloudflare_credentials,
    save_gemini_api_key,
    save_openai_api_key,
    save_anthropic_api_key,
    get_provider_status,
    get_provider_credentials,
    is_provider_configured,
    PROVIDER_MODELS,
)
from analyzer import analyze_text
from chat import send_message

app = FastAPI(title="Writing Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request models ────────────────────────────────────────────────────────────

class SetupRequest(BaseModel):
    provider: str = "cloudflare"  # "cloudflare" | "gemini" | "openai" | "anthropic"
    account_id: str = ""          # cloudflare
    api_token: str = ""           # cloudflare
    api_key: str = ""             # gemini | openai | anthropic

class AnalyzeRequest(BaseModel):
    target: str
    context_before: str = ""
    context_after: str = ""
    mode: str = "line"            # "line" | "structure"
    instructions: str = ""        # assembled by the frontend; structure mode may leave blank
    types: list[str] = []         # allowed type values for the LLM response
    history: list[dict] = []      # prior judgments for sentences in target, same criteria
    persona: str = ""             # user-set persona; empty = neutral writing assistant
    provider: str = "cloudflare"  # "cloudflare" | "gemini" | "openai" | "anthropic"
    model: str = ""                # provider-specific model id; empty = provider default

class ChatRequest(BaseModel):
    session_id: str
    message: str
    context: dict  # { issue_text, issue_type, explanation, suggestions }
    persona: str = ""
    provider: str = "cloudflare"
    model: str = ""


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/status")
def status():
    providers = get_provider_status()
    return {"configured": providers["cloudflare"], "providers": providers, "models": PROVIDER_MODELS}


@app.get("/api/credentials/{provider}")
def get_credentials(provider: str):
    if provider not in PROVIDER_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    return get_provider_credentials(provider)


@app.post("/api/setup")
def setup(req: SetupRequest):
    if req.provider == "cloudflare":
        result = save_cloudflare_credentials(req.account_id, req.api_token)
    elif req.provider == "gemini":
        result = save_gemini_api_key(req.api_key)
    elif req.provider == "openai":
        result = save_openai_api_key(req.api_key)
    elif req.provider == "anthropic":
        result = save_anthropic_api_key(req.api_key)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"ok": True}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    if not is_provider_configured(req.provider):
        raise HTTPException(status_code=401, detail="API key not configured")
    try:
        issues = analyze_text(
            target=req.target,
            context_before=req.context_before,
            context_after=req.context_after,
            mode=req.mode,
            instructions=req.instructions,
            types_list=req.types,
            history=req.history,
            persona=req.persona,
            provider=req.provider,
            model=req.model,
        )
        return {"issues": issues}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat")
def chat(req: ChatRequest):
    if not is_provider_configured(req.provider):
        raise HTTPException(status_code=401, detail="API key not configured")
    try:
        reply = send_message(req.session_id, req.message, req.context, req.persona, req.provider, req.model)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
