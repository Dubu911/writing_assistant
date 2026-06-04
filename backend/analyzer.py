from google import genai
from google.genai import types
import json
import uuid
from config import get_api_key

SYSTEM_TEMPLATE = """\
You are a writing assistant for a non-native English speaker pursuing a PhD.

Check the text for ALL of the following issues:
{instructions}

Return a JSON object with an "issues" array. Each element must have:
  "id"          — unique string, e.g. "i1", "i2"
  "text"        — the EXACT substring from the input that has the problem (copy character-for-character)
  "type"        — one of {types}
  "explanation" — one concise sentence (≤ 20 words) explaining the problem
  "suggestions" — array of 1–3 corrected alternatives (replacement text only, not the full sentence)

Rules:
- "text" must appear verbatim in the input — never paraphrase or trim whitespace
- Only flag real issues; do not flag stylistic preferences
- If no issues found, return {{"issues": []}}
"""


def analyze_text(text: str, instructions: str, types_list: list[str]) -> list[dict]:
    key = get_api_key()
    if not key:
        raise ValueError("API key not configured")

    client = genai.Client(api_key=key)
    system = SYSTEM_TEMPLATE.format(
        instructions=instructions,
        types=json.dumps(types_list),
    )

    resp = client.models.generate_content(
        model="gemini-3.5-flash",
        contents=text,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.1,
            response_mime_type="application/json",
        ),
    )

    data = json.loads(resp.text)
    issues = data.get("issues", [])

    # Guarantee unique IDs and that the flagged text actually exists in the input
    seen = set()
    clean = []
    for issue in issues:
        if not issue.get("id") or issue["id"] in seen:
            issue["id"] = f"i_{uuid.uuid4().hex[:8]}"
        seen.add(issue["id"])
        if issue.get("text") and issue["text"] in text:
            clean.append(issue)

    return clean
