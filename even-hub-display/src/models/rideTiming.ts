import { RideData, RideStatus, isTerminalStatus } from './RideData'
import { formatDistance, haversineMiles, isCoord } from './geo'

/**
 * How long a ride stays on the display after we last heard about it.
 *
 * Uber sends notifications sporadically, so some silence is normal — but past
 * this point we have no idea whether the ride is still happening, and a stale
 * card on a HUD is worse than no card.
 */
export const RIDE_STALE_AFTER_MS = 15 * 60 * 1000

/** Terminal rides linger briefly so the user sees the outcome, then clear. */
export const TERMINAL_RIDE_LINGER_MS = 60 * 1000

/**
 * How long an "arrived" card waits for the trip to start. Uber cancels or
 * charges a no-show after a few minutes at the pickup, so if no trip update
 * has come by then, nothing more is coming.
 */
export const ARRIVED_LINGER_MS = 5 * 60 * 1000

/**
 * A trip in progress may legitimately go quiet for its whole length — a
 * producer might only ever say "trip started". Long enough for a long ride,
 * short enough that a missed "completed" doesn't pin the card all evening.
 */
export const ON_TRIP_STALE_AFTER_MS = 2 * 60 * 60 * 1000

/**
 * Grace period past the promised ETA before we stop trusting the number.
 * Traffic makes ETAs slip; being a couple of minutes over is not a reason to
 * discard the estimate.
 */
export const ETA_GRACE_MINUTES = 3

export interface EtaState {
  /** Minutes remaining, or null when we can no longer justify a number. */
  minutesRemaining: number | null
  /** Short status label for the display. */
  label: string
  /** True when the ETA has run out and we're past the grace period. */
  overdue: boolean
}

function minutesSince(timestamp: string, now: number): number {
  const sent = Date.parse(timestamp)
  if (!Number.isFinite(sent)) return 0
  return Math.max(0, (now - sent) / 60000)
}

/**
 * Count a reported ETA down from the time it was reported.
 *
 * Returns the whole minutes left, 0 inside the grace window after it lapses,
 * or null once it's overdue and we can no longer stand behind a number.
 */
function countdown(minutes: number, timestamp: string, now: number): number | null {
  const remaining = minutes - minutesSince(timestamp, now)
  if (remaining > 0) return Math.ceil(remaining)
  return remaining < -ETA_GRACE_MINUTES ? null : 0
}

/** Trip phase: minutes to the destination, when a producer has said. */
function computeTripEta(ride: RideData, now: number): EtaState {
  if (!isCoord(ride.tripEtaMinutes)) {
    return { minutesRemaining: null, label: 'ON TRIP', overdue: false }
  }

  const minutesRemaining = countdown(ride.tripEtaMinutes, ride.timestamp, now)
  if (minutesRemaining === null) {
    return { minutesRemaining: null, label: 'ON TRIP', overdue: true }
  }
  return {
    minutesRemaining,
    label: minutesRemaining <= 2 ? 'ALMOST THERE' : 'ON TRIP',
    overdue: false
  }
}

/**
 * Work out what to show for the ETA — to pickup, or to the destination once
 * the trip is under way.
 *
 * The previous implementation started from the reported figure and decremented
 * it by one every 60 seconds with `setInterval`, regardless of what had
 * actually happened — after the first notification the number on screen was
 * invented by a timer. This derives it from the timestamp on the data instead,
 * so it stays correct across re-renders, tab sleeps and reconnects, and it
 * admits when it no longer knows.
 */
export function computeEta(ride: RideData, now: number = Date.now()): EtaState {
  const status: RideStatus = ride.status ?? 'enroute'

  if (status === 'arriving') {
    // "Arriving now" outranks any leftover ETA a merge may have preserved —
    // showing "3 MIN" while the car pulls up would contradict the message.
    return { minutesRemaining: 0, label: 'ARRIVING', overdue: false }
  }
  if (status === 'arrived') {
    return { minutesRemaining: 0, label: 'ARRIVED', overdue: false }
  }
  if (status === 'ontrip') {
    return computeTripEta(ride, now)
  }
  if (status === 'completed') {
    return { minutesRemaining: null, label: 'TRIP COMPLETE', overdue: false }
  }
  if (status === 'cancelled') {
    return { minutesRemaining: null, label: 'CANCELLED', overdue: false }
  }

  if (!isCoord(ride.etaMinutes)) {
    // On the way, but nobody has said how long — a first paste from a screen
    // with no minutes on it. Counting down from nothing would read ARRIVING.
    return { minutesRemaining: null, label: 'ON THE WAY', overdue: false }
  }

  const minutesRemaining = countdown(ride.etaMinutes, ride.timestamp, now)

  if (minutesRemaining === null) {
    // Past the promise and the grace window: stop asserting a number.
    return { minutesRemaining: null, label: 'ETA UNKNOWN', overdue: true }
  }
  if (minutesRemaining === 0) {
    return { minutesRemaining: 0, label: 'ARRIVING', overdue: false }
  }
  return {
    minutesRemaining,
    label: minutesRemaining <= 2 ? 'ARRIVING SOON' : 'ON THE WAY',
    overdue: false
  }
}

/**
 * Minutes to size the map's range ring by, or null when no ring should be drawn.
 *
 * Derived from `computeEta` so the ring and the ETA readout can never disagree.
 * Sizing it from the raw `etaMinutes` left a "driver within ~1 mi" ring on
 * screen after the card said ARRIVED, and never shrank it as the ETA ran down.
 * The ring is about the driver reaching you, so it never applies on a trip.
 */
export function rangeRingMinutes(ride: RideData, now: number = Date.now()): number | null {
  if (ride.status === 'ontrip') return null
  const { minutesRemaining } = computeEta(ride, now)
  return minutesRemaining !== null && minutesRemaining > 0 ? minutesRemaining : null
}

/**
 * Where the rider is right now.
 *
 * The phone's live GPS wins. Without it: on a trip the rider is in the car, so
 * the driver's position (from the Uber API) is next best; otherwise the
 * requester coordinates a producer sent.
 */
export function currentPosition(ride: RideData): { lat: number; lng: number } | null {
  if (isCoord(ride.phoneLat) && isCoord(ride.phoneLng)) {
    return { lat: ride.phoneLat, lng: ride.phoneLng }
  }
  if (ride.status === 'ontrip' && isCoord(ride.driverLat) && isCoord(ride.driverLng)) {
    return { lat: ride.driverLat, lng: ride.driverLng }
  }
  if (isCoord(ride.requesterLat) && isCoord(ride.requesterLng)) {
    return { lat: ride.requesterLat, lng: ride.requesterLng }
  }
  return null
}

export interface TripDistance {
  miles: number
  /** True when measured as the crow flies rather than reported along the route. */
  straightLine: boolean
}

/**
 * Distance left to the destination.
 *
 * A producer-reported route distance wins. Failing that, if we know both where
 * the rider is and where they're going, give the straight-line distance —
 * flagged as such, because it understates the drive.
 */
export function tripDistance(ride: RideData): TripDistance | null {
  if (ride.status !== 'ontrip') return null

  if (isCoord(ride.tripRemainingMiles) && ride.tripRemainingMiles >= 0) {
    return { miles: ride.tripRemainingMiles, straightLine: false }
  }

  const here = currentPosition(ride)
  if (here && isCoord(ride.destinationLat) && isCoord(ride.destinationLng)) {
    return {
      miles: haversineMiles(here.lat, here.lng, ride.destinationLat, ride.destinationLng),
      straightLine: true
    }
  }

  return null
}

/** Wall-clock arrival time for the trip, or null when there's no live trip ETA. */
export function tripArrivalTime(ride: RideData, now: number = Date.now()): Date | null {
  if (ride.status !== 'ontrip') return null
  const { minutesRemaining } = computeTripEta(ride, now)
  if (minutesRemaining === null) return null
  return new Date(now + minutesRemaining * 60_000)
}

/**
 * Whether a ride should still be shown at all.
 *
 * `receivedAt` is when the server accepted the payload; it falls back to the
 * ride's own timestamp for producers that don't supply one.
 */
export function isRideStale(
  ride: RideData,
  now: number = Date.now(),
  receivedAt?: number
): boolean {
  const reference = receivedAt ?? Date.parse(ride.timestamp)
  if (!Number.isFinite(reference)) return false

  const age = now - reference
  if (isTerminalStatus(ride.status)) return age > TERMINAL_RIDE_LINGER_MS
  if (ride.status === 'arrived') return age > ARRIVED_LINGER_MS
  if (ride.status === 'ontrip') return age > ON_TRIP_STALE_AFTER_MS
  return age > RIDE_STALE_AFTER_MS
}

/** "4.2 mi left", or "~4.2 mi straight line" when that's all we can measure. */
export function formatTripDistance(distance: TripDistance): string {
  return distance.straightLine
    ? `~${formatDistance(distance.miles)} straight line`
    : `${formatDistance(distance.miles)} left`
}

export interface MapPoints {
  /** The rider. */
  youLat?: number
  youLng?: number
  /** The other end: the driver on the way to pickup, the drop-off on a trip. */
  targetLat?: number
  targetLng?: number
  targetLabel: string
}

/**
 * What the map plots, shared by the phone preview and the glasses raster so
 * the two can't drift apart.
 */
export function mapPoints(ride: RideData): MapPoints {
  if (ride.status === 'ontrip') {
    const here = currentPosition(ride)
    return {
      youLat: here?.lat,
      youLng: here?.lng,
      targetLat: ride.destinationLat,
      targetLng: ride.destinationLng,
      targetLabel: 'Drop-off'
    }
  }
  const here = currentPosition(ride)
  return {
    youLat: here?.lat,
    youLng: here?.lng,
    targetLat: ride.driverLat,
    targetLng: ride.driverLng,
    targetLabel: 'Driver'
  }
}

/** "7:42 PM" in the viewer's local time — short enough for a glasses line. */
export function formatClock(date: Date): string {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}
