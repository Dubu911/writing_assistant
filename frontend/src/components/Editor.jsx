import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import FocusBand from './FocusBand'

const CONTEXT_WORD_BUDGET = 500  // words on each side of the focus

// ── helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Render one paragraph's plain text with any matching issues wrapped in <mark>.
 * Issues are matched only against text inside this paragraph.
 */
function paragraphHTML(text, issues) {
  const hits = issues
    .map((issue) => ({ ...issue, start: text.indexOf(issue.text) }))
    .filter((i) => i.start !== -1)
    .map((i) => ({ ...i, end: i.start + i.text.length }))
    .sort((a, b) => a.start - b.start)
    .filter((issue, idx, arr) => idx === 0 || issue.start >= arr[idx - 1].end)

  if (hits.length === 0) return escapeHtml(text) || '<br>'

  let html = ''
  let pos = 0
  for (const issue of hits) {
    html += escapeHtml(text.slice(pos, issue.start))
    html += `<mark class="issue issue-${issue.type}" data-issue-id="${issue.id}">${escapeHtml(issue.text)}</mark>`
    pos = issue.end
  }
  html += escapeHtml(text.slice(pos))
  return html
}

function saveCursor(el) {
  const sel = window.getSelection()
  if (!sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.endContainer)) return 0
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.endContainer, range.endOffset)
  return pre.toString().length
}

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
  // fall through — place at end
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Pull paragraph strings out of the contenteditable. */
function readParagraphs(el) {
  const ps = el.querySelectorAll('p[data-p]')
  if (ps.length === 0) return [el.innerText.replace(/\n+$/, '')]
  return Array.from(ps).map((p) => p.innerText.replace(/\n+$/, ''))
}

/** Trim leading partial sentence then trailing partial sentence. */
function trimToWholeSentences(text) {
  if (!text) return ''
  // remove leading partial: drop everything before the first sentence-end that has space after
  // simpler: find the first capital letter that starts a sentence
  const first = text.search(/[A-Z]/)
  let trimmed = first > 0 ? text.slice(first) : text

  // trailing: cut after the last sentence-ending punctuation
  const lastEnd = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('?'),
  )
  if (lastEnd > 0) trimmed = trimmed.slice(0, lastEnd + 1)
  return trimmed.trim()
}

function takeWordsFromEnd(text, n) {
  const words = text.split(/(\s+)/)
  let count = 0
  let i = words.length
  while (i > 0 && count < n) {
    i--
    if (words[i].trim()) count++
  }
  return words.slice(i).join('')
}

function takeWordsFromStart(text, n) {
  const words = text.split(/(\s+)/)
  let count = 0
  let i = 0
  while (i < words.length && count < n) {
    if (words[i].trim()) count++
    i++
  }
  return words.slice(0, i).join('')
}

// ── component ─────────────────────────────────────────────────────────────────

const Editor = forwardRef(function Editor(
  {
    issues, mode, onTextChange, onIssueClick, onIssueHover,
    hoveredIssueId, selectedIssueId, focusBand, onFocusBandChange,
  },
  ref,
) {
  const editorRef = useRef(null)
  const [paragraphs, setParagraphs] = useState([''])

  // ── imperative API ─────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    applyFix(issueText, suggestion) {
      const el = editorRef.current
      if (!el) return
      for (const mark of el.querySelectorAll('mark')) {
        if (mark.textContent === issueText) {
          mark.replaceWith(document.createTextNode(suggestion))
          break
        }
      }
      const fresh = readParagraphs(el)
      setParagraphs(fresh)
      onTextChange(fresh.join('\n\n'))
    },

    /**
     * Capture a snapshot for the analyze call based on current mode + focus band.
     * Returns { target, context_before, context_after } or null if nothing usable.
     */
    captureSnapshot() {
      const el = editorRef.current
      if (!el) return null

      if (mode === 'structure') {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !el.contains(sel.anchorNode)) return null
        const target = sel.toString().trim()
        if (!target) return null
        // Use everything before / after the selection as context
        const fullText = readParagraphs(el).join('\n\n')
        const idx = fullText.indexOf(target)
        if (idx === -1) {
          return { target, context_before: '', context_after: '' }
        }
        return {
          target,
          context_before: takeWordsFromEnd(fullText.slice(0, idx), CONTEXT_WORD_BUDGET),
          context_after: takeWordsFromStart(fullText.slice(idx + target.length), CONTEXT_WORD_BUDGET),
        }
      }

      // Line mode — intersect each <p> with the focus band
      const band = focusBand
      if (!band) return null
      const ps = Array.from(el.querySelectorAll('p[data-p]'))
      if (ps.length === 0) return null

      const inFocus = []
      const beforeFocus = []
      const afterFocus = []
      let crossedFocus = false

      for (const p of ps) {
        const r = p.getBoundingClientRect()
        const overlaps = r.bottom > band.top && r.top < band.bottom
        const text = p.innerText.replace(/\n+$/, '')
        if (overlaps) {
          crossedFocus = true
          inFocus.push(text)
        } else if (!crossedFocus) {
          beforeFocus.push(text)
        } else {
          afterFocus.push(text)
        }
      }

      const target = trimToWholeSentences(inFocus.join('\n\n'))
      if (!target) return null

      return {
        target,
        context_before: takeWordsFromEnd(beforeFocus.join('\n\n'), CONTEXT_WORD_BUDGET),
        context_after: takeWordsFromStart(afterFocus.join('\n\n'), CONTEXT_WORD_BUDGET),
      }
    },
  }), [mode, focusBand, onTextChange])

  // ── re-render highlights whenever issues change ────────────────────────────
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const cursor = saveCursor(el)
    // rebuild each paragraph
    const fresh = readParagraphs(el)
    el.innerHTML = fresh
      .map((p, i) => `<p data-p="${i}">${paragraphHTML(p, issues)}</p>`)
      .join('')
    restoreCursor(el, cursor)
  }, [issues])

  // ── initial render: make sure we have at least one paragraph element ──────
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.children.length === 0) {
      el.innerHTML = '<p data-p="0"><br></p>'
    }
  }, [])

  // ── input + interaction ────────────────────────────────────────────────────
  const handleInput = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    // browsers sometimes drop the <p> wrapping; restore it if so
    if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
      const text = el.innerText
      el.innerHTML = text
        .split(/\n\n+/)
        .map((p, i) => `<p data-p="${i}">${escapeHtml(p) || '<br>'}</p>`)
        .join('')
    }
    const fresh = readParagraphs(el)
    setParagraphs(fresh)
    onTextChange(fresh.join('\n\n'))
  }, [onTextChange])

  const handleClick = useCallback(
    (e) => {
      const mark = e.target.closest('mark[data-issue-id]')
      if (!mark) return
      const issueId = mark.getAttribute('data-issue-id')
      const rect = mark.getBoundingClientRect()
      onIssueClick(issueId, rect)
    },
    [onIssueClick],
  )

  const handleMouseOver = useCallback(
    (e) => {
      const mark = e.target.closest('mark[data-issue-id]')
      onIssueHover?.(mark ? mark.getAttribute('data-issue-id') : null)
    },
    [onIssueHover],
  )

  const handleMouseLeave = useCallback(() => onIssueHover?.(null), [onIssueHover])

  // ── highlight whatever the right-panel is hovering / selected ────────────
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    for (const mark of el.querySelectorAll('mark[data-issue-id]')) {
      const id = mark.getAttribute('data-issue-id')
      mark.classList.toggle('issue-hovered', id === hoveredIssueId)
      mark.classList.toggle('issue-selected', id === selectedIssueId)
    }
  }, [hoveredIssueId, selectedIssueId, issues])

  return (
    <div className="editor-wrap">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="editor"
        data-placeholder="Start writing here…"
        onInput={handleInput}
        onClick={handleClick}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        spellCheck={false}
      />
      {mode === 'line' && (
        <FocusBand band={focusBand} onChange={onFocusBandChange} />
      )}
    </div>
  )
})

export default Editor
