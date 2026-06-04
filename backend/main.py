import sys
import os

# Make sure Python finds config/analyzer/chat as sibling modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from config import get_api_key, save_api_key
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
    api_key: str

class AnalyzeRequest(BaseModel):
    target: str
    context_before: str = ""
    context_after: str = ""
    mode: str = "line"            # "line" | "structure"
    instructions: str = ""        # assembled by the frontend; structure mode may leave blank
    types: list[str] = []         # allowed type values for the LLM response

class ChatRequest(BaseModel):
    session_id: str
    message: str
    context: dict  # { issue_text, issue_type, explanation, suggestions }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/status")
def status():
    return {"configured": bool(get_api_key())}


@app.post("/api/setup")
def setup(req: SetupRequest):
    result = save_api_key(req.api_key)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"ok": True}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    if not get_api_key():
        raise HTTPException(status_code=401, detail="API key not configured")
    try:
        issues = analyze_text(
            target=req.target,
            context_before=req.context_before,
            context_after=req.context_after,
            mode=req.mode,
            instructions=req.instructions,
            types_list=req.types,
        )
        return {"issues": issues}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat")
def chat(req: ChatRequest):
    if not get_api_key():
        raise HTTPException(status_code=401, detail="API key not configured")
    try:
        reply = send_message(req.session_id, req.message, req.context)
        return {"reply": reply}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
