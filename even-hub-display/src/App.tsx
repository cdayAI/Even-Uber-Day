import { useState, useEffect, useMemo, useRef } from 'react'
import { RideData } from './models/RideData'
import { SourceMode, applyUpdate, detectMode, fetchRide } from './rideSource'
import { runDemoRide } from './demoRide'
import { PhoneLocation, usePhoneLocation } from './glasses/usePhoneLocation'
import { setLogRelay } from './glasses/log'
import RideCard from './components/RideCard'
import PasteFromUber from './components/PasteFromUber'
import StatusView from './components/StatusView'
import RideHistory from './components/RideHistory'
import SettingsPanel from './components/SettingsPanel'
import { useGlasses } from './glasses/useGlasses'
import { RideHistoryEntry, trackRide } from './models/rideHistory'
import './App.css'

type AppView = 'ride' | 'history' | 'settings'

const POLL_INTERVAL = 2000
const STORAGE_KEY = 'even_uber_rides'
const THEME_KEY = 'even_uber_theme'

function withPhone(ride: RideData | null, location: PhoneLocation | null): RideData | null {
  return ride && location ? { ...ride, phoneLat: location.lat, phoneLng: location.lng } : ride
}

function loadHistory(): RideHistoryEntry[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    // Convert date strings back to Date objects
    return (JSON.parse(saved) as RideHistoryEntry[]).map(entry => ({
      ...entry,
      startTime: new Date(entry.startTime),
      endTime: entry.endTime ? new Date(entry.endTime) : undefined
    }))
  } catch (error) {
    console.error('Failed to load ride history:', error)
    return []
  }
}

export default function App() {
  // The ride the source holds right now. The glasses always follow this.
  const [liveRide, setLiveRide] = useState<RideData | null>(null)
  // The ride the phone card shows — kept after the ride ends when auto-hide is off.
  const [rideData, setRideData] = useState<RideData | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mode, setMode] = useState<SourceMode | null>(null)

  // Ride history state
  const [rideHistory, setRideHistory] = useState<RideHistoryEntry[]>(loadHistory)

  // UI state
  const [activeView, setActiveView] = useState<AppView>('ride')
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved ? JSON.parse(saved) : false
  })

  // Settings state
  // Mirror the current ride onto the G2 glasses. No-ops outside the Even App
  // WebView, so the browser preview is unaffected.
  //
  // The phone's live GPS is layered on at display time rather than stored, so
  // it never fights with whatever the ride source holds.
  const phoneLocation = usePhoneLocation()
  const glassesRide = useMemo(() => withPhone(liveRide, phoneLocation), [liveRide, phoneLocation])
  const cardRide = useMemo(() => withPhone(rideData, phoneLocation), [rideData, phoneLocation])
  const glassesActive = useGlasses(glassesRide)

  const stopDemo = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDemo.current?.(), [])
  const startDemo = () => {
    if (!mode) return
    stopDemo.current?.()
    stopDemo.current = runDemoRide(
      (update) => void applyUpdate(mode, update),
      phoneLocation
    )
  }

  const [pollInterval, setPollInterval] = useState(POLL_INTERVAL)
  const [showNotifications, setShowNotifications] = useState(true)
  const [autoHideCompleted, setAutoHideCompleted] = useState(true)

  // Initialize theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem(THEME_KEY, JSON.stringify(isDarkMode))
  }, [isDarkMode])

  // Save ride history to storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rideHistory))
    } catch (error) {
      console.error('Failed to save ride history:', error)
    }
  }, [rideHistory])

  // Work out where ride data lives: the dev server, or this page (.ehpk)
  useEffect(() => {
    console.log('🚀 Even Uber display app initializing...')
    detectMode().then((detected) => {
      console.log(`📡 Ride source: ${detected}`)
      setLogRelay(detected === 'server')
      setMode(detected)
      setIsReady(true)
      setIsLoading(false)
    })
  }, [])

  // Read by the poll without restarting it. With ride state in the effect's
  // dependencies, every server response — a new object each time — tore the
  // interval down and fired an immediate tick: ~130 requests a second.
  const settings = useRef({ showNotifications, autoHideCompleted })
  settings.current = { showNotifications, autoHideCompleted }
  const lastSeen = useRef<RideData | null>(null)

  // Main polling effect
  useEffect(() => {
    if (!mode) return

    const tick = async () => {
      try {
        const newRide = await fetchRide(mode)
        setIsConnected(true)
        setConnectionError(null)

        const previous = lastSeen.current
        lastSeen.current = newRide
        setLiveRide(newRide)
        setRideHistory(prev => trackRide(prev, newRide))

        if (newRide) {
          setRideData(newRide)
          if (newRide.timestamp !== previous?.timestamp) setLastUpdate(new Date())
          if (!previous && settings.current.showNotifications) {
            console.log(`✅ New ride: ${newRide.driverName}`)
          }
        } else if (previous) {
          if (settings.current.autoHideCompleted) setRideData(null)
          console.log('🛑 Ride completed')
        }
      } catch (error) {
        console.error('❌ Failed to fetch ride data:', error)
        setIsConnected(false)
        setConnectionError('Polling error: ' + (error instanceof Error ? error.message : 'Unknown'))
      }
    }

    void tick()
    const poll = setInterval(tick, pollInterval)
    return () => clearInterval(poll)
  }, [mode, pollInterval])

  // Handle view navigation
  const handleViewChange = (view: AppView) => {
    setActiveView(view)
  }

  // Clear ride history
  const handleClearHistory = () => {
    if (window.confirm('Clear all ride history?')) {
      setRideHistory([])
    }
  }

  return (
    <div className="app" data-theme={isDarkMode ? 'dark' : 'light'}>
      <header className="app-header">
        <div className="header-content">
          <h1>🚗 Even Uber</h1>
          <p>Real-time Uber tracking on G2 AR glasses</p>
        </div>
        <div className="header-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '🟢' : '🔴'}
          </span>
        </div>
      </header>

      {/* Navigation tabs */}
      <nav className="app-nav">
        <button
          className={`nav-btn ${activeView === 'ride' ? 'active' : ''}`}
          onClick={() => handleViewChange('ride')}
        >
          🚗 Ride
        </button>
        <button
          className={`nav-btn ${activeView === 'history' ? 'active' : ''}`}
          onClick={() => handleViewChange('history')}
        >
          📋 History ({rideHistory.length})
        </button>
        <button
          className={`nav-btn ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => handleViewChange('settings')}
        >
          ⚙️ Settings
        </button>
      </nav>

      {/* Main content area */}
      <main className="app-main">
        {isLoading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Initializing...</p>
          </div>
        ) : activeView === 'ride' ? (
          isReady && !cardRide ? (
            <>
              {mode && <PasteFromUber mode={mode} currentRide={liveRide} />}
              <StatusView lastUpdate={lastUpdate} onSimulate={startDemo} />
            </>
          ) : isReady && cardRide ? (
            <>
              {mode && <PasteFromUber mode={mode} currentRide={liveRide} />}
              <RideCard data={cardRide} />
            </>
          ) : (
            <div className="empty-state">
              <p>No active ride</p>
            </div>
          )
        ) : activeView === 'history' ? (
          <RideHistory rides={rideHistory} onClear={handleClearHistory} />
        ) : (
          <SettingsPanel
            isDarkMode={isDarkMode}
            onThemeChange={setIsDarkMode}
            pollInterval={pollInterval}
            onPollIntervalChange={setPollInterval}
            showNotifications={showNotifications}
            onNotificationsChange={setShowNotifications}
            autoHideCompleted={autoHideCompleted}
            onAutoHideChange={setAutoHideCompleted}
          />
        )}
      </main>

      {/* Footer with connection status */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="connection-status">
            <span className={`status-light ${isConnected ? 'connected' : 'disconnected'}`}></span>
            <span>
              {mode === 'local' ? '📱 Running on phone' : isConnected ? '🟢 Connected' : '🔴 Disconnected'}
              {connectionError && ` (${connectionError})`}
            </span>
          </div>
          {lastUpdate && (
            <div className="last-update">
              Last update: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>
      </footer>

      {/* Debug console for development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="debug-console">
          <details>
            <summary>🐛 Debug Info</summary>
            <pre>
              {JSON.stringify(
                {
                  connected: isConnected,
                  error: connectionError,
                  hasRideData: !!rideData,
                  glassesActive,
                  rideHistory: rideHistory.length,
                  pollInterval,
                  currentRide: rideData,
                  lastUpdate: lastUpdate?.toISOString()
                },
                null,
                2
              )}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
