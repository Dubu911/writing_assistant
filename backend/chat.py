from config import (
    get_cloudflare_credentials,
    get_gemini_api_key,
    get_openai_api_key,
    get_anthropic_api_key,
)
from cf_client import call_cloudflare
from gemini_client import call_gemini
from openai_client import call_openai
from anthropic_client import call_anthropic


def _get_credentials(provider: str):
    if provider == "cloudflare":
        return get_cloudflare_credentials()
    if provider == "gemini":
        return get_gemini_api_key()
    if provider == "openai":
        return get_openai_api_key()
    if provider == "anthropic":
        return get_anthropic_api_key()
    return None

# session_id -> list of {"role": ..., "content": ...} messages, starting with
# the system message. In-memory, resets on server restart — fine.
_sessions: dict[str, list[dict]] = {}

SYSTEM_PROMPT = """\
{persona_line}
The user is asking about a specific writing suggestion.

Context:
  Problematic text : "{issue_text}"
  Issue type       : {issue_type}
  Explanation      : {explanation}
  Suggestions given: {suggestions}

Answer clearly and concisely.
- Grammar rule questions: state the rule briefly, give one short example.
- Word meaning questions: one-sentence definition.
- "Why" questions: 2–3 sentences max.
Never rewrite large portions of text — focus on the specific issue."""


def _persona_line(persona: str) -> str:
    p = (persona or "").strip()
    if not p:
        return "You are a writing tutor helping the user understand a suggestion."
    return f"You are {p}."


def send_message(session_id: str, message: str, context: dict, persona: str = "", provider: str = "cloudflare", model: str = "") -> str:
    creds = _get_credentials(provider)
    if not creds:
        raise ValueError("API key not configured")

    if session_id not in _sessions:
        system_prompt = SYSTEM_PROMPT.format(
            persona_line=_persona_line(persona),
            issue_text=context.get("issue_text", ""),
            issue_type=context.get("issue_type", "grammar"),
            explanation=context.get("explanation", ""),
            suggestions=", ".join(context.get("suggestions", [])),
        )
        _sessions[session_id] = [{"role": "system", "content": system_prompt}]

    history = _sessions[session_id]
    history.append({"role": "user", "content": message})

    if provider == "cloudflare":
        account_id, api_token = creds
        reply = call_cloudflare(account_id, api_token, history, model=model or None, max_tokens=300, temperature=0.3)
    elif provider == "gemini":
        reply = call_gemini(creds, history, model=model or None, max_tokens=300, temperature=0.3)
    elif provider == "openai":
        reply = call_openai(creds, history, model=model or None, max_tokens=300, temperature=0.3)
    else:
        reply = call_anthropic(creds, history, model=model or None, max_tokens=300, temperature=0.3)

    history.append({"role": "assistant", "content": reply})
    return reply
