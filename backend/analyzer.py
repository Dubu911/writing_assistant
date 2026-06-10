from google import genai
from google.genai import types
import json
import uuid
import time
from config import get_api_key, MODEL_NAME

_RETRY_DELAYS = [5, 10]  # seconds between attempts for transient errors

def _is_transient(exc: Exception) -> bool:
    msg = str(exc)
    return any(tag in msg for tag in ('503', '429', 'UNAVAILABLE', 'RESOURCE_EXHAUSTED'))

LINE_SYSTEM_TEMPLATE = """\
{persona_line}

You will receive THREE blocks of text:
  <context_before> ... </context_before>   (read-only background — DO NOT critique)
  <target>         ... </target>           (the ONLY text you may critique)
  <context_after>  ... </context_after>    (read-only background — DO NOT critique)

Use the context blocks to understand the flow, references, and intent of the target.
Critique ONLY the target. Never flag, suggest, or rewrite anything that appears outside the <target> block.

Check the target for ALL of the following issues:
{instructions}

Return a JSON object with an "issues" array. Each element must have:
  "id"          — unique string, e.g. "i1", "i2"
  "text"        — the EXACT substring from the TARGET that has the problem (copy character-for-character)
  "type"        — one of {types}
  "explanation" — one concise sentence (≤ 20 words) explaining the problem
  "suggestions" — array of 1–3 corrected alternatives (replacement text only, not the full sentence)

Rules:
- "text" must appear verbatim inside the <target> block — never paraphrase, never trim whitespace, never pull text from context blocks
- Only flag real issues; do not flag stylistic preferences
- If no issues found, return {{"issues": []}}
"""

STRUCTURE_SYSTEM_TEMPLATE = """\
{persona_line}

You will receive THREE blocks of text:
  <context_before> ... </context_before>   (read-only background)
  <target>         ... </target>           (the section under review)
  <context_after>  ... </context_after>    (read-only background)

Use the context blocks to understand where this section sits in the larger work.
Comment ONLY on the target. Focus on HIGH-LEVEL structural issues:
{instructions}

Do NOT nitpick grammar, word choice, or single sentences. If the only issues are small, return an empty list.

Return a JSON object with an "issues" array. Each element must have:
  "id"          — unique string, e.g. "s1", "s2"
  "text"        — a short verbatim substring from the TARGET that anchors the comment (1 sentence or a few words; must appear character-for-character in the target)
  "type"        — one of {types}
  "explanation" — 1–3 sentences explaining the structural concern
  "suggestions" — array of 1–3 short, high-level suggestions (e.g. "move this paragraph after X", "split this section in two"). NOT full rewrites.

Rules:
- "text" must appear verbatim inside the <target> block
- Prefer fewer, higher-value comments over many small ones
- If no structural issues, return {{"issues": []}}
"""

STRUCTURE_DEFAULT_INSTRUCTIONS = """\
1. Argument flow — do ideas build in a logical order, or does the reader get lost?
2. Pacing — any section that drags, jumps, or repeats itself?
3. Organization — are paragraphs and sections grouped by topic? Any orphaned ideas?
4. Transitions — do sections connect smoothly, or are there jarring shifts?
5. Coherence — does the section deliver on what it sets up?"""

STRUCTURE_DEFAULT_TYPES = ["flow", "pacing", "organization", "transition", "coherence"]


def _format_history_block(history: list[dict]) -> str:
    """Render a 'previously reviewed' block. One line per sentence.
    The model is told: don't re-flag unless the sentence is clearly still broken."""
    lines = []
    for entry in history:
        sentence = entry.get("sentence", "").strip()
        if not sentence:
            continue
        flag = entry.get("flag", "")
        action = entry.get("action", "")
        suggestion = (entry.get("suggestion") or "").strip()
        if action == "accepted" and suggestion:
            lines.append(
                f'- Sentence: "{sentence}"\n'
                f'  Previously flagged as {flag}; user already applied a fix. Treat as resolved unless still clearly broken.'
            )
        else:
            lines.append(
                f'- Sentence: "{sentence}"\n'
                f'  Previously flagged as {flag}; user kept it as-is. Do NOT re-flag the same concern unless it is clearly still broken.'
            )
    if not lines:
        return ""
    return (
        "\n\n<prior_reviews>\n"
        "These sentences in <target> have been reviewed under the same criteria before.\n"
        "Prefer silence over marginal repeat suggestions; only re-flag if the issue is clearly still present.\n\n"
        + "\n".join(lines)
        + "\n</prior_reviews>"
    )


def _persona_line(persona: str, mode: str) -> str:
    """Opening sentence for the system prompt. Empty persona → neutral default.
    User-set persona fully replaces the line; no PhD / non-native assumptions
    are appended on top of it."""
    p = (persona or "").strip()
    if not p:
        # Neutral defaults differ by mode so behavior matches the section's purpose.
        return (
            "You are a structural editor reviewing the user's writing."
            if mode == "structure"
            else "You are a writing assistant reviewing the user's writing."
        )
    return f"You are {p}."


def analyze_text(
    target: str,
    context_before: str = "",
    context_after: str = "",
    mode: str = "line",
    instructions: str = "",
    types_list: list[str] | None = None,
    history: list[dict] | None = None,
    persona: str = "",
) -> list[dict]:
    key = get_api_key()
    if not key:
        raise ValueError("API key not configured")

    if mode == "structure":
        system_template = STRUCTURE_SYSTEM_TEMPLATE
        if not instructions.strip():
            instructions = STRUCTURE_DEFAULT_INSTRUCTIONS
        if not types_list:
            types_list = STRUCTURE_DEFAULT_TYPES
    else:
        system_template = LINE_SYSTEM_TEMPLATE
        if not types_list:
            types_list = ["grammar"]

    client = genai.Client(api_key=key)
    system = system_template.format(
        persona_line=_persona_line(persona, mode),
        instructions=instructions,
        types=json.dumps(types_list),
    )

    payload = (
        f"<context_before>\n{context_before}\n</context_before>\n\n"
        f"<target>\n{target}\n</target>\n\n"
        f"<context_after>\n{context_after}\n</context_after>"
    )
    if mode == "line" and history:
        payload += _format_history_block(history)

    last_exc = None
    for attempt, delay in enumerate([0] + _RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            resp = client.models.generate_content(
                model=MODEL_NAME,
                contents=payload,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0.1,
                    response_mime_type="application/json",
                ),
            )
            last_exc = None
            break
        except Exception as exc:
            last_exc = exc
            if attempt < len(_RETRY_DELAYS) and _is_transient(exc):
                continue
            raise
    if last_exc:
        raise last_exc

    data = json.loads(resp.text)
    issues = data.get("issues", [])

    seen = set()
    clean = []
    for issue in issues:
        if not issue.get("id") or issue["id"] in seen:
            issue["id"] = f"i_{uuid.uuid4().hex[:8]}"
        seen.add(issue["id"])
        # Must appear verbatim in the target — never elsewhere
        if issue.get("text") and issue["text"] in target:
            clean.append(issue)

    return clean
