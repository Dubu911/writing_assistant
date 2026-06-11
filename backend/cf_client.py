import requests
from config import CF_API_BASE, CF_MODEL_NAME


def call_cloudflare(account_id, api_token, messages, *, model=None, json_mode=False, max_tokens=None, temperature=None):
    """POST a chat-completion request to Cloudflare Workers AI and return the
    model's reply text. `model` defaults to CF_MODEL_NAME when not given.
    Raises RuntimeError("Cloudflare API error <code>: <msg>") on failure — the
    leading numeric code lets callers classify transient vs hard errors by
    substring match."""
    url = f"{CF_API_BASE}/{account_id}/ai/run/{model or CF_MODEL_NAME}"
    body = {"messages": messages}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if temperature is not None:
        body["temperature"] = temperature

    resp = requests.post(url, headers={"Authorization": f"Bearer {api_token}"}, json=body, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"Cloudflare API error {resp.status_code}: {resp.text}")

    data = resp.json()
    if not data.get("success", False):
        errors = data.get("errors") or []
        msg = errors[0]["message"] if errors else "Unknown Cloudflare error"
        code = errors[0].get("code", "") if errors else ""
        raise RuntimeError(f"Cloudflare API error {code}: {msg}")

    return data["result"]["response"]
