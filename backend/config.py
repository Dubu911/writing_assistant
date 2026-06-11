from pathlib import Path
from dotenv import load_dotenv, set_key
import os
import requests
from google import genai
from openai import OpenAI
from anthropic import Anthropic

ENV_PATH = Path(__file__).parent.parent / ".env"

# fp8 is ~2x cheaper in neurons (13778/26128 vs 25608/75147 per M tokens),
# meaning roughly 2x more daily calls under the 10,000 neuron/day free cap.
# The 70B option trades that budget for noticeably stronger feedback quality.
CF_MODELS = [
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
]
CF_MODEL_NAME = CF_MODELS[0]

GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"]
GEMINI_MODEL_NAME = GEMINI_MODELS[0]

OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o"]
OPENAI_MODEL_NAME = OPENAI_MODELS[0]

ANTHROPIC_MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]
ANTHROPIC_MODEL_NAME = ANTHROPIC_MODELS[0]

# Per-provider model choices, exposed via /api/status so the frontend never
# hardcodes model ids.
PROVIDER_MODELS = {
    "cloudflare": CF_MODELS,
    "gemini": GEMINI_MODELS,
    "openai": OPENAI_MODELS,
    "anthropic": ANTHROPIC_MODELS,
}

CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts"


def get_cloudflare_credentials() -> tuple[str, str] | None:
    load_dotenv(ENV_PATH, override=True)
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")
    api_token = os.getenv("CLOUDFLARE_API_TOKEN")
    if account_id and api_token:
        return account_id, api_token
    return None


def save_cloudflare_credentials(account_id: str, api_token: str) -> dict:
    """Validate the credential pair against Cloudflare with a tiny request,
    then persist to .env."""
    url = f"{CF_API_BASE}/{account_id}/ai/run/{CF_MODEL_NAME}"
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_token}"},
            json={"messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
            timeout=15,
        )
    except requests.RequestException as e:
        return {"ok": False, "error": f"Could not reach Cloudflare: {e}"}

    if resp.status_code in (401, 403):
        return {"ok": False, "error": "Invalid API token — check it and try again."}
    if resp.status_code == 404:
        return {"ok": False, "error": "Invalid Account ID — check it and try again."}
    if not resp.ok:
        try:
            errors = resp.json().get("errors") or []
            msg = errors[0]["message"] if errors else resp.text
        except Exception:
            msg = resp.text
        return {"ok": False, "error": msg}

    data = resp.json()
    if not data.get("success", False):
        errors = data.get("errors") or []
        msg = errors[0]["message"] if errors else "Unknown Cloudflare error"
        return {"ok": False, "error": msg}

    ENV_PATH.touch(exist_ok=True)
    set_key(str(ENV_PATH), "CLOUDFLARE_ACCOUNT_ID", account_id)
    set_key(str(ENV_PATH), "CLOUDFLARE_API_TOKEN", api_token)
    return {"ok": True}


def get_gemini_api_key() -> str | None:
    load_dotenv(ENV_PATH, override=True)
    return os.getenv("GEMINI_API_KEY") or None


def save_gemini_api_key(key: str) -> dict:
    """Validate the key against Gemini, then persist it to .env."""
    try:
        client = genai.Client(api_key=key)
        client.models.generate_content(
            model=GEMINI_MODEL_NAME,
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


def get_openai_api_key() -> str | None:
    load_dotenv(ENV_PATH, override=True)
    return os.getenv("OPENAI_API_KEY") or None


def save_openai_api_key(key: str) -> dict:
    """Validate the key against OpenAI, then persist it to .env."""
    try:
        client = OpenAI(api_key=key)
        client.chat.completions.create(
            model=OPENAI_MODEL_NAME,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
        )
    except Exception as e:
        msg = str(e)
        if "401" in msg or "invalid_api_key" in msg.lower() or "incorrect api key" in msg.lower():
            return {"ok": False, "error": "Invalid API key — check it and try again."}
        return {"ok": False, "error": msg}

    ENV_PATH.touch(exist_ok=True)
    set_key(str(ENV_PATH), "OPENAI_API_KEY", key)
    return {"ok": True}


def get_anthropic_api_key() -> str | None:
    load_dotenv(ENV_PATH, override=True)
    return os.getenv("ANTHROPIC_API_KEY") or None


def save_anthropic_api_key(key: str) -> dict:
    """Validate the key against Anthropic, then persist it to .env."""
    try:
        client = Anthropic(api_key=key)
        client.messages.create(
            model=ANTHROPIC_MODEL_NAME,
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
    except Exception as e:
        msg = str(e)
        if "401" in msg or "authentication_error" in msg.lower() or "invalid x-api-key" in msg.lower():
            return {"ok": False, "error": "Invalid API key — check it and try again."}
        return {"ok": False, "error": msg}

    ENV_PATH.touch(exist_ok=True)
    set_key(str(ENV_PATH), "ANTHROPIC_API_KEY", key)
    return {"ok": True}


def get_provider_credentials(provider: str) -> dict:
    """Raw stored credential value(s) for a provider, for display/copy in the UI."""
    if provider == "cloudflare":
        creds = get_cloudflare_credentials()
        account_id, api_token = creds if creds else ("", "")
        return {"account_id": account_id, "api_token": api_token}
    if provider == "gemini":
        return {"api_key": get_gemini_api_key() or ""}
    if provider == "openai":
        return {"api_key": get_openai_api_key() or ""}
    if provider == "anthropic":
        return {"api_key": get_anthropic_api_key() or ""}
    return {}


def get_provider_status() -> dict:
    """Which providers currently have usable credentials on file."""
    return {
        "cloudflare": get_cloudflare_credentials() is not None,
        "gemini": get_gemini_api_key() is not None,
        "openai": get_openai_api_key() is not None,
        "anthropic": get_anthropic_api_key() is not None,
    }


def is_provider_configured(provider: str) -> bool:
    return get_provider_status().get(provider, False)
