/**
 * Lifecycle of a ride, so the display knows when to stop showing a card.
 *
 * Without this the last ride stayed on screen forever — a HUD confidently
 * reporting "1 MIN · ARRIVING" long after the trip ended.
 */
export type RideStatus =
  | 'enroute'    // driver on the way, ETA meaningful
  | 'arriving'   // pulling up now
  | 'arrived'    // waiting at the pickup point
  | 'ontrip'     // rider picked up, heading to the destination
  | 'completed'  // trip finished
  | 'cancelled'  // ride cancelled

/**
 * Statuses after which the card should be cleared rather than kept alive.
 *
 * 'arrived' is deliberately not here: the trip starts next, and clearing the
 * card a minute after pickup left nothing on the glasses for the ride itself.
 */
export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = [
  'completed',
  'cancelled'
]

export function isTerminalStatus(status?: RideStatus): boolean {
  return status !== undefined && TERMINAL_RIDE_STATUSES.includes(status)
}

/**
 * Stand-in name for a ride the user started from a screen that didn't show the
 * driver. Not a driver: a later update naming one is the same ride.
 */
export const UNKNOWN_DRIVER = 'Your driver'

/**
 * RideData model matching the iOS companion app + advanced features
 */
export interface RideData {
  /** Defaults to 'enroute' when a producer omits it. */
  status?: RideStatus
  driverName: string
  driverRating: number
  vehicleMake: string
  vehicleModel: string
  vehicleColor: string
  licensePlate: string
  /**
   * Minutes to pickup as of `timestamp`. Null when the ride is known but no
   * one has said how long — 0 would mean "arriving", which is a claim.
   */
  etaMinutes: number | null
  driverLat?: number
  driverLng?: number
  requesterLat?: number
  requesterLng?: number
  timestamp: string
  // On trip — all optional; the card degrades to "ON TRIP" without them
  /** Minutes to the destination as of `timestamp`. */
  tripEtaMinutes?: number
  /** Route distance left as reported by the producer, in miles. */
  tripRemainingMiles?: number
  destinationName?: string
  destinationLat?: number
  destinationLng?: number
  /**
   * The phone's own live position, from the Even App's location service.
   * Display-side only — producers don't send it. Beats every other source for
   * "where you are", since requester coordinates are the pickup point.
   */
  phoneLat?: number
  phoneLng?: number
  // Advanced features
  driverPhone?: string
  driverAvatar?: string
  vehiclePhoto?: string
  driverFullName?: string
  totalRides?: number
  acceptanceRate?: number
  cancellationRate?: number
}

/**
 * Chat message interface for driver communication
 */
export interface ChatMessage {
  id: string
  sender: 'driver' | 'user'
  message: string
  timestamp: Date
  read: boolean
}

/**
 * API request/response types
 */
export interface RideUpdateRequest extends RideData {
  // Same structure as RideData
}

export interface ApiResponse<T> {
  status: string
  data?: T
  error?: string
  message?: string
}

export interface HealthResponse {
  status: string
  uptime?: number
  timestamp?: string
}

/** "4.95", "4.9", "5.0" — Uber shows two decimals; rounding 4.95 up to 5.0 overstates it. */
export function formatRating(rating: number): string {
  const two = rating.toFixed(2)
  return two.endsWith('0') ? rating.toFixed(1) : two
}
