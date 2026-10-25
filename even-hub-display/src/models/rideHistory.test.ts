import { describe, expect, it } from 'vitest'
import { RideData, UNKNOWN_DRIVER } from './RideData'
import { RideHistoryEntry, trackRide } from './rideHistory'

const T0 = Date.parse('2026-10-15T12:00:00Z')

function ride(overrides: Partial<RideData> = {}): RideData {
  return {
    driverName: 'John D.',
    driverRating: 4.9,
    vehicleMake: 'Toyota',
    vehicleModel: 'Prius',
    vehicleColor: 'Silver',
    licensePlate: 'ABC123',
    etaMinutes: 5,
    timestamp: new Date(T0).toISOString(),
    ...overrides
  }
}

const at = (ms: number) => new Date(T0 + ms).toISOString()

describe('trackRide', () => {
  it('opens an entry for a new ride', () => {
    const history = trackRide([], ride(), T0)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ data: { driverName: 'John D.' }, startTime: new Date(T0) })
    expect(history[0].endTime).toBeUndefined()
  })

  it('returns the same array while nothing changes', () => {
    const history = trackRide([], ride(), T0)
    // A server poll returns an equal but new object every time.
    expect(trackRide(history, ride(), T0 + 2_000)).toBe(history)
  })

  it('picks the open entry back up after a reopen instead of duplicating it', () => {
    const before = trackRide([], ride(), T0)
    // Reopened: history restored from storage, the store still holds the ride.
    const restored: RideHistoryEntry[] = JSON.parse(JSON.stringify(before)).map(
      (e: RideHistoryEntry) => ({ ...e, startTime: new Date(e.startTime) })
    )
    const after = trackRide(restored, ride({ status: 'ontrip', timestamp: at(300_000) }), T0 + 300_000)
    expect(after).toHaveLength(1)
    expect(after[0].data.status).toBe('ontrip')
  })

  it('treats the stand-in driver name as the same ride once it is named', () => {
    const first = trackRide([], ride({ driverName: UNKNOWN_DRIVER }), T0)
    const named = trackRide(first, ride({ driverName: 'Maria', timestamp: at(60_000) }), T0 + 60_000)
    expect(named).toHaveLength(1)
    expect(named[0].data.driverName).toBe('Maria')
  })

  it('closes the entry at the last update it saw, not when the ride vanished', () => {
    let history = trackRide([], ride(), T0)
    history = trackRide(history, ride({ status: 'completed', timestamp: at(20 * 60_000) }), T0 + 20 * 60_000)
    // The store drops a finished ride a minute later.
    history = trackRide(history, null, T0 + 21 * 60_000)
    expect(history[0].endTime).toEqual(new Date(T0 + 20 * 60_000))
    expect(history[0].duration).toBe(20 * 60_000)
  })

  it('closes an entry once, not again on every poll', () => {
    const closed = trackRide(trackRide([], ride(), T0), null, T0 + 60_000)
    expect(trackRide(closed, null, T0 + 62_000)).toBe(closed)
  })

  it('starts a new entry for a different driver', () => {
    const first = trackRide([], ride(), T0)
    const second = trackRide(first, ride({ driverName: 'Maria', timestamp: at(60_000) }), T0 + 60_000)
    expect(second).toHaveLength(2)
    expect(second[0].endTime).toBeDefined()
    expect(second[1].data.driverName).toBe('Maria')
  })
})
