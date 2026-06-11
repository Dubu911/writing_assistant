from openai import OpenAI
from config import OPENAI_MODEL_NAME


def call_openai(api_key, messages, *, model=None, json_mode=False, max_tokens=None, temperature=None):
    """Send an OpenAI-style messages list to the OpenAI Chat Completions API
    and return the reply text. `model` defaults to OPENAI_MODEL_NAME when not
    given. Raises RuntimeError on failure, preserving the SDK's error text
    verbatim so callers can pattern-match OpenAI's error vocabulary
    (429, insufficient_quota, rate_limit_exceeded, 500/502/503)."""
    client = OpenAI(api_key=api_key)

    kwargs = {}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if temperature is not None:
        kwargs["temperature"] = temperature

    try:
        resp = client.chat.completions.create(
            model=model or OPENAI_MODEL_NAME,
            messages=messages,
            **kwargs,
        )
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc

    return resp.choices[0].message.content
