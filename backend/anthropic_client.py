from anthropic import Anthropic
from config import ANTHROPIC_MODEL_NAME


def call_anthropic(api_key, messages, *, model=None, json_mode=False, max_tokens=None, temperature=None):
    """Send an OpenAI-style messages list to the Anthropic Messages API and
    return the reply text. `model` defaults to ANTHROPIC_MODEL_NAME when not
    given. Anthropic takes the system prompt separately from `messages` and
    requires `max_tokens`; `json_mode` has no native equivalent here — the
    existing _parse_json_response repair pipeline handles Claude's fenced
    JSON output. Raises RuntimeError on failure, preserving the SDK's error
    text verbatim so callers can pattern-match (429, overloaded_error, 529,
    500/502/503)."""
    client = Anthropic(api_key=api_key)

    system = ""
    chat_messages = []
    for m in messages:
        if m["role"] == "system":
            system = (system + "\n" + m["content"]).strip()
        else:
            chat_messages.append(m)

    kwargs = {"max_tokens": max_tokens or 1024}
    if system:
        kwargs["system"] = system
    if temperature is not None:
        kwargs["temperature"] = temperature

    try:
        resp = client.messages.create(
            model=model or ANTHROPIC_MODEL_NAME,
            messages=chat_messages,
            **kwargs,
        )
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc

    return resp.content[0].text
