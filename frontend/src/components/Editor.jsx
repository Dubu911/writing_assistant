import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

// ── DOM helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Rebuild the editor's innerHTML, wrapping each issue's text in a <mark>.
 * Overlapping issues are skipped (first one wins).
 */
function buildHTML(text, issues) {
  const sorted = issues
    .map((issue) => ({ ...issue, start: text.indexOf(issue.text) }))
    .filter((i) => i.start !== -1)
    .map((i) => ({ ...i, end: i.start + i.text.length }))
    .sort((a, b) => a.start - b.start)
    .filter((issue, idx, arr) => idx === 0 || issue.start >= arr[idx - 1].end)

  let html = ''
  let pos = 0
  for (const issue of sorted) {
    html += escapeHtml(text.slice(pos, issue.start))
    html += `<mark class="issue issue-${issue.type}" data-issue-id="${issue.id}">${escapeHtml(issue.text)}</mark>`
    pos = issue.end
  }
  html += escapeHtml(text.slice(pos))
  return html.replace(/\n/g, '<br>')
}

/**
 * Save cursor position as a character offset from the start of the element.
 * Works across nested nodes (e.g. <mark> elements).
 */
function saveCursor(el) {
  const sel = window.getSelection()
  if (!sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.endContainer, range.endOffset)
  return pre.toString().length
}

/**
 * Restore cursor from a character offset by walking text nodes.
 */
function restoreCursor(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let chars = 0
  let node
  while ((node = walker.nextNode())) {
    const len = node.textContent.length
    if (chars + len >= offset) {
      const range = document.createRange()
      range.setStart(node, offset - chars)
      range.collapse(true)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    chars += len
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

const Editor = forwardRef(function Editor({ issues, onTextChange, onIssueClick }, ref) {
  const editorRef = useRef(null)

  // Expose applyFix so App can call it when the user accepts a suggestion
  useImperativeHandle(ref, () => ({
    applyFix(issueText, suggestion) {
      const el = editorRef.current
      if (!el) return
      // Find the <mark> for this issue and replace with plain text
      for (const mark of el.querySelectorAll('mark')) {
        if (mark.textContent === issueText) {
          mark.replaceWith(document.createTextNode(suggestion))
          break
        }
      }
      onTextChange(el.innerText)
    },
  }), [onTextChange])

  // Rebuild highlights whenever the issue list changes
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const text = el.innerText.replace(/\n$/, '') // drop trailing newline browsers add
    if (!text.trim()) {
      el.innerHTML = ''
      return
    }
    const cursor = saveCursor(el)
    el.innerHTML = buildHTML(text, issues)
    restoreCursor(el, cursor)
  }, [issues])

  const handleInput = useCallback(() => {
    const text = editorRef.current?.innerText ?? ''
    onTextChange(text)
  }, [onTextChange])

  const handleClick = useCallback(
    (e) => {
      const mark = e.target.closest('mark[data-issue-id]')
      if (!mark) return
      const issueId = mark.getAttribute('data-issue-id')
      const rect = mark.getBoundingClientRect()
      onIssueClick(issueId, rect)
    },
    [onIssueClick]
  )

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      className="editor"
      data-placeholder="Start writing here…"
      onInput={handleInput}
      onClick={handleClick}
      spellCheck={false}
    />
  )
})

export default Editor
