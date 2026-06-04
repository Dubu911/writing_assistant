import { useEffect, useRef } from 'react'

/**
 * Two viewport-fixed pastel-dotted horizontal lines marking the active focus zone.
 * `band` = { top, bottom } in viewport pixels.
 * Dragging either line updates the band via onChange.
 */
export default function FocusBand({ band, onChange }) {
  const draggingRef = useRef(null) // 'top' | 'bottom' | null

  useEffect(() => {
    function onMove(e) {
      const which = draggingRef.current
      if (!which) return
      const y = Math.max(40, Math.min(window.innerHeight - 40, e.clientY))
      if (which === 'top') {
        onChange({ top: Math.min(y, band.bottom - 60), bottom: band.bottom })
      } else {
        onChange({ top: band.top, bottom: Math.max(y, band.top + 60) })
      }
    }
    function onUp() {
      draggingRef.current = null
      document.body.classList.remove('focus-dragging')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [band, onChange])

  if (!band) return null

  function startDrag(which) {
    draggingRef.current = which
    document.body.classList.add('focus-dragging')
  }

  return (
    <>
      <div
        className="focus-line focus-line-top"
        style={{ top: band.top }}
        onMouseDown={() => startDrag('top')}
        title="Drag to move top of focus zone"
      />
      <div
        className="focus-line focus-line-bottom"
        style={{ top: band.bottom }}
        onMouseDown={() => startDrag('bottom')}
        title="Drag to move bottom of focus zone"
      />
    </>
  )
}
