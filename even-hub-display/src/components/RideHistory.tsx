import { RideData, formatRating } from '../models/RideData'
import '../styles/RideHistory.css'

interface RideHistoryEntry {
  id: string
  data: RideData
  startTime: Date
  endTime?: Date
  duration?: number
}

interface RideHistoryProps {
  rides: RideHistoryEntry[]
  onClear: () => void
}

export default function RideHistory({ rides, onClear }: RideHistoryProps) {
  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60

    if (minutes === 0) {
      return `${remainingSeconds}s`
    }
    return `${minutes}m ${remainingSeconds}s`
  }

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString()
  }

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString()
  }

  if (rides.length === 0) {
    return (
      <div className="ride-history">
        <div className="empty-history">
          <p>📋 No ride history yet</p>
          <p className="empty-hint">Order an Uber ride to see it here</p>
        </div>
      </div>
    )
  }

  const rated = rides.filter(r => r.data.driverRating > 0)

  // Group rides by date
  const ridesByDate = rides.reduce(
    (acc, ride) => {
      const date = formatDate(ride.startTime)
      if (!acc[date]) {
        acc[date] = []
      }
      acc[date].push(ride)
      return acc
    },
    {} as Record<string, RideHistoryEntry[]>
  )

  const sortedDates = Object.keys(ridesByDate).sort((a, b) => {
    return new Date(b).getTime() - new Date(a).getTime()
  })

  return (
    <div className="ride-history">
      <div className="history-header">
        <h2>Ride History</h2>
        <button className="clear-btn" onClick={onClear} title="Clear all rides">
          🗑️ Clear
        </button>
      </div>

      {sortedDates.map(date => (
        <div key={date} className="history-date-group">
          <h3 className="date-header">{date}</h3>

          <div className="rides-list">
            {ridesByDate[date].map((ride, index) => (
              <div key={ride.id} className="ride-item">
                <div className="ride-number">#{ridesByDate[date].length - index}</div>

                <div className="ride-info">
                  <div className="driver-section">
                    <div className="driver-name">{ride.data.driverName}</div>
                    {ride.data.driverRating > 0 && (
                      <div className="driver-rating">⭐ {formatRating(ride.data.driverRating)}</div>
                    )}
                  </div>

                  <div className="vehicle-section">
                    <div className="vehicle">
                      {ride.data.vehicleColor} {ride.data.vehicleMake} {ride.data.vehicleModel}
                    </div>
                    <div className="plate">{ride.data.licensePlate}</div>
                  </div>

                  <div className="time-section">
                    <div className="ride-time">
                      <span className="label">Started:</span>
                      <span>{formatTime(ride.startTime)}</span>
                    </div>

                    {ride.endTime && (
                      <>
                        <div className="ride-time">
                          <span className="label">Ended:</span>
                          <span>{formatTime(ride.endTime)}</span>
                        </div>

                        {ride.duration && (
                          <div className="ride-duration">
                            <span className="label">Duration:</span>
                            <span>{formatDuration(ride.duration)}</span>
                          </div>
                        )}
                      </>
                    )}

                    {!ride.endTime && <div className="ride-status">🟢 Active</div>}
                  </div>
                </div>

                <div className="ride-badge">
                  {ride.endTime ? '✅ Completed' : '🚗 Active'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="history-stats">
        <div className="stat">
          <div className="stat-label">Total Rides</div>
          <div className="stat-value">{rides.length}</div>
        </div>

        <div className="stat">
          <div className="stat-label">Completed</div>
          <div className="stat-value">{rides.filter(r => r.endTime).length}</div>
        </div>

        {/* Rides started from a screen with no driver card have no rating;
            counting them as 0 would drag the average down. */}
        {rated.length > 0 && (
          <div className="stat">
            <div className="stat-label">Avg Rating</div>
            <div className="stat-value">
              ⭐ {(rated.reduce((sum, r) => sum + r.data.driverRating, 0) / rated.length).toFixed(1)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
