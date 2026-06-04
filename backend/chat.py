from google import genai
from google.genai import types
from config import get_api_key

# Store active chat sessions — resets on server restart, which is fine
_sessions: dict[str, genai.chats.Chat] = {}

SYSTEM_PROMPT = """\
You are a friendly writing tutor helping a non-native English speaker doing a PhD.
The user is asking about a specific writing suggestion.

Context:
  Problematic text : "{issue_text}"
  Issue type       : {issue_type}
  Explanation      : {explanation}
  Suggestions given: {suggestions}

Answer clearly and concisely using simple English.
- Grammar rule questions: state the rule briefly, give one short example.
- Word meaning questions: one-sentence definition.
- "Why" questions: 2–3 sentences max.
Never rewrite large portions of text — focus on the specific issue."""


def send_message(session_id: str, message: str, context: dict) -> str:
    key = get_api_key()
    client = genai.Client(api_key=key)

    if session_id not in _sessions:
        _sessions[session_id] = client.chats.create(
            model="gemini-3.5-flash",
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT.format(
                    issue_text=context.get("issue_text", ""),
                    issue_type=context.get("issue_type", "grammar"),
                    explanation=context.get("explanation", ""),
                    suggestions=", ".join(context.get("suggestions", [])),
                ),
                temperature=0.3,
                max_output_tokens=300,
            ),
        )

    resp = _sessions[session_id].send_message(message)
    return resp.text
