export interface StatusViewProps {
  lastUpdate?: Date | null
  /** Starts a scripted demo ride; shown when provided. */
  onSimulate?: () => void
}

/**
 * Waiting state - displays before any ride data arrives
 */
export default function StatusView({ lastUpdate, onSimulate }: StatusViewProps) {
  return (
    <div className="status-view">
      <div className="status-content">
        <div className="spinner"></div>
        <h2>Waiting for ride data...</h2>
        <p className="status-detail">
          {lastUpdate
            ? `Last update: ${lastUpdate.toLocaleTimeString()}`
            : 'No rides active yet'}
        </p>
        <p className="status-help">
          Order a ride in the Uber app to get started
        </p>
        {onSimulate && (
          <button className="nav-btn" onClick={onSimulate}>
            ▶️ Simulate a ride
          </button>
        )}
      </div>

      <div className="status-info">
        <h3>How it works:</h3>
        {/* iOS won't let another app read Uber's screen or notifications, so
            the user's own Shortcut does the reading. See SHORTCUT.md. */}
        <ol>
          <li>
            Once: in Shortcuts, make <strong>Uber → Even</strong> (Take Screenshot →
            Extract Text from Image → Copy to Clipboard) and set it as your Back Tap
          </li>
          <li>With your driver showing in the Uber app, double-tap the back of the phone</li>
          <li>Come back here and tap <strong>Paste from Uber</strong></li>
          <li>See it on your G2 glasses</li>
        </ol>
      </div>
    </div>
  )
}
