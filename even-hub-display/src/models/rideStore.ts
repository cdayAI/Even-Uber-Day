import { RideData } from './RideData'
import { completeRide, mergeRide } from './rideMerge'
import { isRideStale } from './rideTiming'

export type ApplyResult =
  | { status: 'updated'; ride: RideData }
  | { status: 'ignored'; reason: string }
  | { status: 'invalid'; error: string }

export interface StoredRide {
  ride: RideData
  /** Epoch ms when the latest update was accepted. */
  receivedAt: number
}

/**
 * The single active ride, and the rules for changing it.
 *
 * Shared by the dev server (which receives updates over HTTP) and the
 * standalone app on the phone (which receives them locally), so both apply
 * exactly the same validation, merging and expiry.
 */
export class RideStore {
  private stored: StoredRide | null

  constructor(initial: StoredRide | null = null, private onChange?: (s: StoredRide | null) => void) {
    // A ride persisted by an older version may be missing fields the card
    // needs; restoring it unrepaired would crash the app on every open.
    this.stored = initial ? { ...initial, ride: completeRide(initial.ride) } : null
  }

  apply(incoming: RideData, now: number = Date.now()): ApplyResult {
    // Transitions — "arriving now", "has arrived", "trip started", "trip
    // complete" — carry a status and often nothing else; that's their whole
    // point. Only a plain en-route update must identify a driver and quote an ETA.
    const transition = incoming.status !== undefined && incoming.status !== 'enroute'
    if (!transition && (!incoming.driverName || incoming.etaMinutes === undefined)) {
      return { status: 'invalid', error: 'Missing required fields: driverName, etaMinutes' }
    }

    const existing = this.current(now)

    // A transition modifies the ride on screen; it never starts one. Post-trip
    // notifications ("your receipt is ready", "rate your trip") keep arriving
    // long after a trip ends, and without this a stray receipt would raise a
    // blank "TRIP COMPLETE" card on the glasses out of nowhere.
    if (transition && !existing && !incoming.driverName) {
      return { status: 'ignored', reason: 'No active ride to update' }
    }

    const ride = mergeRide(existing, incoming)
    this.set({ ride, receivedAt: now })
    return { status: 'updated', ride }
  }

  /**
   * The ride to show, or null. Drops it once stale, so the glasses stop showing
   * a card for a trip that ended long ago.
   */
  current(now: number = Date.now()): RideData | null {
    if (!this.stored) return null
    if (isRideStale(this.stored.ride, now, this.stored.receivedAt)) {
      this.set(null)
      return null
    }
    return this.stored.ride
  }

  receivedAt(): number | null {
    return this.stored?.receivedAt ?? null
  }

  clear(): void {
    this.set(null)
  }

  private set(next: StoredRide | null): void {
    this.stored = next
    this.onChange?.(next)
  }
}
