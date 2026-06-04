from pathlib import Path
from dotenv import load_dotenv, set_key
import os
from google import genai

ENV_PATH = Path(__file__).parent.parent / ".env"


def get_api_key() -> str | None:
    load_dotenv(ENV_PATH, override=True)
    return os.getenv("GEMINI_API_KEY") or None


def save_api_key(key: str) -> dict:
    """Validate the key against Gemini, then persist it to .env."""
    try:
        client = genai.Client(api_key=key)
        client.models.generate_content(
            model="gemini-3.5-flash",
            contents="hi",
            config={"max_output_tokens": 1},
        )
    except Exception as e:
        msg = str(e)
        if "API_KEY_INVALID" in msg or "invalid" in msg.lower() or "403" in msg:
            return {"ok": False, "error": "Invalid API key — check it and try again."}
        return {"ok": False, "error": msg}

    ENV_PATH.touch(exist_ok=True)
    set_key(str(ENV_PATH), "GEMINI_API_KEY", key)
    return {"ok": True}
