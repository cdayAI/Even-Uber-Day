import { RideData } from './RideData'
import { namedDriver } from './rideMerge'

export interface RideHistoryEntry {
  id: string
  data: RideData
  startTime: Date
  endTime?: Date
  duration?: number
}

/**
 * Fold the active ride — or its absence — into the history.
 *
 * The last entry stays open while its ride is active and follows it as later
 * updates fill it in. Reopening the app mid-ride picks that entry back up
 * rather than starting a second one; the old rule ("no entry id in memory, so
 * this must be new") duplicated the ride on every reopen, which the paste
 * workflow does at least twice a trip.
 *
 * Called on every poll, so it returns the same array when nothing changed.
 */
export function trackRide(
  history: RideHistoryEntry[],
  ride: RideData | null,
  now: number = Date.now()
): RideHistoryEntry[] {
  const last = history[history.length - 1]
  const open = last && !last.endTime ? last : null

  if (!ride) {
    return open ? [...history.slice(0, -1), close(open, now)] : history
  }

  if (open && sameRide(open.data, ride)) {
    if (open.data.timestamp === ride.timestamp && open.data.status === ride.status) return history
    return [...history.slice(0, -1), { ...open, data: ride }]
  }

  const settled = open ? [...history.slice(0, -1), close(open, now)] : history
  return [...settled, { id: `ride_${now}`, data: ride, startTime: new Date(now) }]
}

/** A stand-in driver name matches anyone: it's the same ride, named later. */
function sameRide(a: RideData, b: RideData): boolean {
  const first = namedDriver(a.driverName)
  const second = namedDriver(b.driverName)
  return !first || !second || first === second
}

/**
 * End an entry at the last update it saw — normally "trip complete" — rather
 * than when we noticed the ride was gone, which is up to a minute later on a
 * finished trip, or hours later if the app was closed.
 */
function close(entry: RideHistoryEntry, now: number): RideHistoryEntry {
  const start = entry.startTime.getTime()
  const lastSeen = Date.parse(entry.data.timestamp)
  const end = Number.isFinite(lastSeen) && lastSeen >= start && lastSeen <= now ? lastSeen : now
  return { ...entry, endTime: new Date(end), duration: end - start }
}
