import { useState } from 'react'
import { RideData } from '../models/RideData'
import { parseUberText, pasteUpdate } from '../models/uberText'
import { SourceMode, applyUpdate } from '../rideSource'

export interface PasteFromUberProps {
  mode: SourceMode
  currentRide: RideData | null
}

/**
 * Pull ride details from text copied off the Uber app.
 *
 * Pairs with an iOS Shortcut on Back Tap: screenshot → Extract Text → Copy.
 * Reading the clipboard directly is one tap, but a WebView may refuse it, so a
 * paste box is the fallback that always works.
 */
export default function PasteFromUber({ mode, currentRide }: PasteFromUberProps) {
  const [showBox, setShowBox] = useState(false)
  const [text, setText] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const apply = async (raw: string) => {
    const { update, found } = parseUberText(raw)
    if (found.length === 0) {
      setMessage("Couldn't find ride details in that text")
      return
    }

    const result = await applyUpdate(mode, pasteUpdate(update, currentRide !== null))
    if (result.status === 'updated') {
      setMessage(`✅ ${found.join(' · ')}`)
      setText('')
      setShowBox(false)
    } else {
      setMessage(`⚠️ ${result.status === 'invalid' ? result.error : result.reason}`)
    }
  }

  const pasteFromClipboard = async () => {
    setMessage(null)
    try {
      const clip = await navigator.clipboard.readText()
      if (clip.trim()) {
        await apply(clip)
        return
      }
    } catch {
      // Clipboard access refused — fall through to the paste box.
    }
    setShowBox(true)
  }

  return (
    <div className="paste-uber">
      <button className="nav-btn" onClick={pasteFromClipboard}>
        📋 Paste from Uber
      </button>

      {showBox && (
        <div className="paste-box">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Long-press here and choose Paste"
            rows={4}
          />
          <button className="nav-btn" onClick={() => apply(text)} disabled={!text.trim()}>
            Use this text
          </button>
        </div>
      )}

      {message && <p className="paste-message">{message}</p>}
    </div>
  )
}
