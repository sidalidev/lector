import { useState, useRef, useEffect, useCallback } from 'react'
import './Tooltip.css'

// Tooltip réutilisable: enveloppe n'importe quel enfant
// Usage : <Tooltip text="Explication courte"> <MonBadge /> </Tooltip>
function Tooltip({ text, children, position = 'top', delay = 400 }) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const tooltipRef = useRef(null)
  const timerRef = useRef(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  // Positionner le tooltip par rapport au trigger
  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    const tip = tooltipRef.current.getBoundingClientRect()
    const padding = 8

    let top, left
    switch (position) {
      case 'bottom':
        top = trigger.bottom + padding
        left = trigger.left + trigger.width / 2 - tip.width / 2
        break
      case 'left':
        top = trigger.top + trigger.height / 2 - tip.height / 2
        left = trigger.left - tip.width - padding
        break
      case 'right':
        top = trigger.top + trigger.height / 2 - tip.height / 2
        left = trigger.right + padding
        break
      default: // top
        top = trigger.top - tip.height - padding
        left = trigger.left + trigger.width / 2 - tip.width / 2
    }

    // Garder dans le viewport
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (left < 8) left = 8
    if (left + tip.width > vw - 8) left = vw - tip.width - 8
    if (top < 8) top = trigger.bottom + padding // flip en bas
    if (top + tip.height > vh - 8) top = trigger.top - tip.height - padding // flip en haut

    setCoords({ top, left })
  }, [visible, position])

  // Cleanup timer
  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!text) return children

  return (
    <>
      <span
        ref={triggerRef}
        className="tooltip-trigger"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {visible && (
        <div
          ref={tooltipRef}
          className={`tooltip-bubble tooltip-${position}`}
          style={{ top: coords.top, left: coords.left }}
          role="tooltip"
        >
          {text}
        </div>
      )}
    </>
  )
}

export default Tooltip
