import { RideData, UNKNOWN_DRIVER } from './RideData'
import { isCoord } from './geo'

/** The driver's name, or undefined when there's no real one. */
export function namedDriver(name?: string): string | undefined {
  return name && name !== UNKNOWN_DRIVER ? name : undefined
}

/**
 * Fill in the fields every consumer reads.
 *
 * The first update of a ride is whatever its producer had: a paste from the
 * trip screen carries no rating, car or plate. Stored as-is, the card printed
 * "undefined" for the car and threw on the rating — and since the ride is
 * persisted, the app stayed blank on every reopen until it expired.
 */
export function completeRide(ride: RideData): RideData {
  return {
    ...ride,
    driverName: ride.driverName ?? '',
    driverRating: isCoord(ride.driverRating) ? ride.driverRating : 0,
    vehicleMake: ride.vehicleMake ?? '',
    vehicleModel: ride.vehicleModel ?? '',
    vehicleColor: ride.vehicleColor ?? '',
    licensePlate: ride.licensePlate ?? '',
    etaMinutes: isCoord(ride.etaMinutes) ? ride.etaMinutes : null
  }
}

/**
 * Fold an incoming update onto the ride already on screen.
 *
 * Uber's notifications are incremental, and the terminal ones are the sparsest:
 * "Your driver has arrived" carries a status and nothing else. Replacing
 * wholesale would blank the driver card at the exact moment the user looks up
 * to find their car, so empty incoming fields defer to what we already know.
 * Status, ETA and timestamp always come from the newer message.
 */
export function mergeRide(previous: RideData | null, incoming: RideData): RideData {
  if (!previous) return completeRide(incoming)

  const preferIncoming = <T>(next: T | undefined, prev: T | undefined): T | undefined =>
    next === undefined || next === null || next === '' ? prev : next

  // A different driver means a different ride — don't carry anything over.
  // The stand-in name of a ride started without one isn't a driver, so the
  // first update that does name one fills it in rather than starting afresh.
  const incomingName = namedDriver(incoming.driverName)
  const previousName = namedDriver(previous.driverName)
  if (incomingName && previousName && incomingName !== previousName) {
    return completeRide(incoming)
  }

  return {
    ...previous,
    ...incoming,
    driverName: incomingName ?? (previous.driverName || incoming.driverName || ''),
    driverRating: incoming.driverRating || previous.driverRating,
    vehicleMake: preferIncoming(incoming.vehicleMake, previous.vehicleMake) ?? '',
    vehicleModel: preferIncoming(incoming.vehicleModel, previous.vehicleModel) ?? '',
    vehicleColor: preferIncoming(incoming.vehicleColor, previous.vehicleColor) ?? '',
    licensePlate: preferIncoming(incoming.licensePlate, previous.licensePlate) ?? '',
    driverLat: preferIncoming(incoming.driverLat, previous.driverLat),
    driverLng: preferIncoming(incoming.driverLng, previous.driverLng),
    requesterLat: preferIncoming(incoming.requesterLat, previous.requesterLat),
    requesterLng: preferIncoming(incoming.requesterLng, previous.requesterLng),
    // An en-route update with no ETA keeps the previous one rather than
    // resetting the countdown to zero.
    etaMinutes: incoming.etaMinutes || previous.etaMinutes,
    destinationName: preferIncoming(incoming.destinationName, previous.destinationName),
    destinationLat: preferIncoming(incoming.destinationLat, previous.destinationLat),
    destinationLng: preferIncoming(incoming.destinationLng, previous.destinationLng),
    tripRemainingMiles: preferIncoming(incoming.tripRemainingMiles, previous.tripRemainingMiles),
    tripEtaMinutes: incoming.tripEtaMinutes ?? carryTripEta(previous, incoming.timestamp)
  }
}

/**
 * Carry a trip ETA across an update that doesn't restate it.
 *
 * The countdown runs from the ride's timestamp, and the merged ride takes the
 * newer one — so keeping the old figure as-is would wind the clock back up by
 * however long passed between the two updates. Re-base it instead.
 */
function carryTripEta(previous: RideData, nextTimestamp: string): number | undefined {
  if (previous.tripEtaMinutes === undefined || previous.tripEtaMinutes === null) return undefined
  const then = Date.parse(previous.timestamp)
  const now = Date.parse(nextTimestamp)
  if (!Number.isFinite(then) || !Number.isFinite(now)) return previous.tripEtaMinutes
  return Math.max(0, previous.tripEtaMinutes - Math.max(0, now - then) / 60_000)
}
