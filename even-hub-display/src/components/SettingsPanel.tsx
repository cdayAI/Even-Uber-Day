import appInfo from '../../app.json'
import '../styles/SettingsPanel.css'

interface SettingsPanelProps {
  isDarkMode: boolean
  onThemeChange: (dark: boolean) => void
  pollInterval: number
  onPollIntervalChange: (interval: number) => void
  showNotifications: boolean
  onNotificationsChange: (show: boolean) => void
  autoHideCompleted: boolean
  onAutoHideChange: (autoHide: boolean) => void
}

export default function SettingsPanel({
  isDarkMode,
  onThemeChange,
  pollInterval,
  onPollIntervalChange,
  showNotifications,
  onNotificationsChange,
  autoHideCompleted,
  onAutoHideChange
}: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <h2>⚙️ Settings</h2>

      {/* Display Settings */}
      <div className="settings-section">
        <h3>Display</h3>

        <div className="setting-item">
          <label htmlFor="dark-mode">🌙 Dark Mode</label>
          <div className="setting-control">
            <input
              id="dark-mode"
              type="checkbox"
              checked={isDarkMode}
              onChange={e => onThemeChange(e.target.checked)}
              className="toggle-switch"
            />
            <span className="toggle-label">{isDarkMode ? 'On' : 'Off'}</span>
          </div>
        </div>
      </div>

      {/* Polling Settings */}
      <div className="settings-section">
        <h3>Polling & Updates</h3>

        <div className="setting-item">
          <label htmlFor="poll-interval">📊 Poll Interval</label>
          <div className="setting-control">
            <input
              id="poll-interval"
              type="range"
              min="1000"
              max="5000"
              step="500"
              value={pollInterval}
              onChange={e => onPollIntervalChange(Number(e.target.value))}
              className="slider"
            />
            <span className="value-display">{pollInterval}ms</span>
          </div>
          <p className="setting-hint">How often to check for ride updates (1-5 seconds)</p>
        </div>

        <div className="setting-item">
          <label htmlFor="notifications">🔔 Show Notifications</label>
          <div className="setting-control">
            <input
              id="notifications"
              type="checkbox"
              checked={showNotifications}
              onChange={e => onNotificationsChange(e.target.checked)}
              className="toggle-switch"
            />
            <span className="toggle-label">{showNotifications ? 'On' : 'Off'}</span>
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="auto-hide">✨ Auto-hide Completed Rides</label>
          <div className="setting-control">
            <input
              id="auto-hide"
              type="checkbox"
              checked={autoHideCompleted}
              onChange={e => onAutoHideChange(e.target.checked)}
              className="toggle-switch"
            />
            <span className="toggle-label">{autoHideCompleted ? 'On' : 'Off'}</span>
          </div>
          <p className="setting-hint">Clear the ride card on the phone once the ride ends. The glasses always clear.</p>
        </div>
      </div>

      {/* About Section */}
      <div className="settings-section">
        <h3>About</h3>

        <div className="about-info">
          <div className="info-item">
            <span className="label">App</span>
            <span className="value">Even Uber Display</span>
          </div>

          <div className="info-item">
            <span className="label">Version</span>
            <span className="value">{appInfo.version}</span>
          </div>

          <div className="info-item">
            <span className="label">Server URL</span>
            <span className="value">{window.location.origin}</span>
          </div>

          <div className="info-item">
            <span className="label">Updated</span>
            <span className="value">August 2026</span>
          </div>
        </div>

        <div className="about-description">
          <p>
            Real-time Uber tracking on G2 AR glasses. This app displays ride information from the
            iOS companion app.
          </p>

          <div className="feature-list">
            <h4>Features:</h4>
            <ul>
              <li>✅ Live driver tracking</li>
              <li>✅ Real-time ETA updates</li>
              <li>✅ Vehicle information</li>
              <li>✅ Interactive location map</li>
              <li>✅ Ride history tracking</li>
              <li>✅ Dark mode support</li>
              <li>✅ Customizable polling</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Developer Info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="settings-section debug-section">
          <h3>🔧 Developer</h3>

          <div className="dev-info">
            <p>
              <strong>Current Settings:</strong>
            </p>
            <ul>
              <li>Dark Mode: {isDarkMode ? 'ON' : 'OFF'}</li>
              <li>Poll Interval: {pollInterval}ms</li>
              <li>Notifications: {showNotifications ? 'ON' : 'OFF'}</li>
              <li>Auto-hide: {autoHideCompleted ? 'ON' : 'OFF'}</li>
            </ul>

            <p className="warning">
              💡 Tip: Open Browser DevTools (F12) to see console logs and debug information
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
