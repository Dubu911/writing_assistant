from google import genai
from google.genai import types
from config import GEMINI_MODEL_NAME


def call_gemini(api_key, messages, *, model=None, json_mode=False, max_tokens=None, temperature=None):
    """Send an OpenAI-style messages list to Gemini and return the reply text.
    `model` defaults to GEMINI_MODEL_NAME (flash-lite) when not given, so the
    caller can pick e.g. "gemini-2.5-flash" per request.
    Raises RuntimeError on failure, preserving the underlying SDK exception
    text verbatim so callers can pattern-match Gemini's error vocabulary
    (503, 429, UNAVAILABLE, RESOURCE_EXHAUSTED, quota strings)."""
    client = genai.Client(api_key=api_key)

    system_instruction = None
    contents = []
    for m in messages:
        if m["role"] == "system":
            system_instruction = m["content"]
        else:
            role = "model" if m["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})

    config_kwargs = {}
    if system_instruction is not None:
        config_kwargs["system_instruction"] = system_instruction
    if temperature is not None:
        config_kwargs["temperature"] = temperature
    if max_tokens is not None:
        config_kwargs["max_output_tokens"] = max_tokens
    if json_mode:
        config_kwargs["response_mime_type"] = "application/json"

    try:
        resp = client.models.generate_content(
            model=model or GEMINI_MODEL_NAME,
            contents=contents,
            config=types.GenerateContentConfig(**config_kwargs),
        )
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc

    return resp.text
