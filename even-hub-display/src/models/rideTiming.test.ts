import { describe, expect, it } from 'vitest'
import { RideData, RideStatus, isTerminalStatus } from './RideData'
import {
  ARRIVED_LINGER_MS,
  ETA_GRACE_MINUTES,
  ON_TRIP_STALE_AFTER_MS,
  RIDE_STALE_AFTER_MS,
  TERMINAL_RIDE_LINGER_MS,
  computeEta,
  formatClock,
  formatTripDistance,
  isRideStale,
  mapPoints,
  rangeRingMinutes,
  tripArrivalTime,
  tripDistance
} from './rideTiming'
import { mergeRide } from './rideMerge'

const T0 = Date.parse('2026-08-17T12:00:00Z')
const MINUTE = 60_000

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

describe('computeEta', () => {
  it('counts down from the timestamp rather than from render time', () => {
    expect(computeEta(ride(), T0).minutesRemaining).toBe(5)
    expect(computeEta(ride(), T0 + 2 * MINUTE).minutesRemaining).toBe(3)
    expect(computeEta(ride(), T0 + 4 * MINUTE).minutesRemaining).toBe(1)
  })

  it('is stable regardless of how many times it is called', () => {
    const r = ride()
    const a = computeEta(r, T0 + MINUTE)
    const b = computeEta(r, T0 + MINUTE)
    expect(a).toEqual(b)
  })

  it('says ARRIVING once the estimate runs out, within the grace window', () => {
    const state = computeEta(ride(), T0 + 6 * MINUTE)
    expect(state.label).toBe('ARRIVING')
    expect(state.minutesRemaining).toBe(0)
    expect(state.overdue).toBe(false)
  })

  it('stops asserting a number past the grace window', () => {
    const past = T0 + (5 + ETA_GRACE_MINUTES + 1) * MINUTE
    const state = computeEta(ride(), past)
    expect(state.label).toBe('ETA UNKNOWN')
    expect(state.minutesRemaining).toBeNull()
    expect(state.overdue).toBe(true)
  })

  it('reports terminal statuses without inventing an ETA', () => {
    const cases: Array<[RideStatus, string, number | null]> = [
      ['arrived', 'ARRIVED', 0],
      ['completed', 'TRIP COMPLETE', null],
      ['cancelled', 'CANCELLED', null]
    ]

    for (const [status, label, minutes] of cases) {
      // Deliberately far past the ETA — status must win over the clock.
      const state = computeEta(ride({ status }), T0 + 90 * MINUTE)
      expect(state.label).toBe(label)
      expect(state.minutesRemaining).toBe(minutes)
    }
  })

  it('flags urgency near arrival', () => {
    expect(computeEta(ride(), T0 + 3 * MINUTE).label).toBe('ARRIVING SOON')
    expect(computeEta(ride(), T0).label).toBe('ON THE WAY')
  })

  it('lets "arriving" outrank a leftover ETA', () => {
    // A bare "arriving now" merge preserves the previous etaMinutes; the
    // status must win or the card says "3 MIN" while the car pulls up.
    const state = computeEta(ride({ status: 'arriving', etaMinutes: 3 }), T0)
    expect(state.label).toBe('ARRIVING')
    expect(state.minutesRemaining).toBe(0)
    expect(state.overdue).toBe(false)
  })
})

describe('rangeRingMinutes', () => {
  it('shrinks with the live ETA instead of sticking to the reported figure', () => {
    expect(rangeRingMinutes(ride(), T0)).toBe(5)
    expect(rangeRingMinutes(ride(), T0 + 3 * MINUTE)).toBe(2)
  })

  it.each<RideStatus>(['arriving', 'arrived', 'completed', 'cancelled'])(
    'draws no ring once the ride is %s, even with a leftover ETA',
    status => {
      expect(rangeRingMinutes(ride({ status, etaMinutes: 3 }), T0)).toBeNull()
    }
  )

  it('draws no ring once the ETA has run out or gone unknown', () => {
    expect(rangeRingMinutes(ride(), T0 + 6 * MINUTE)).toBeNull()
    expect(rangeRingMinutes(ride(), T0 + (5 + ETA_GRACE_MINUTES + 1) * MINUTE)).toBeNull()
  })
})

describe('isRideStale', () => {
  it('keeps an en-route ride through a quiet spell', () => {
    expect(isRideStale(ride(), T0 + 5 * MINUTE, T0)).toBe(false)
  })

  it('drops an en-route ride once it goes quiet for too long', () => {
    expect(isRideStale(ride(), T0 + RIDE_STALE_AFTER_MS + 1, T0)).toBe(true)
  })

  it('clears terminal rides quickly so the card comes off the glasses', () => {
    const finished = ride({ status: 'completed' })
    expect(isRideStale(finished, T0 + 30_000, T0)).toBe(false)
    expect(isRideStale(finished, T0 + TERMINAL_RIDE_LINGER_MS + 1, T0)).toBe(true)
  })

  it('keeps an arrived card long enough for the trip to start', () => {
    const waiting = ride({ status: 'arrived' })
    expect(isRideStale(waiting, T0 + TERMINAL_RIDE_LINGER_MS + 1, T0)).toBe(false)
    expect(isRideStale(waiting, T0 + ARRIVED_LINGER_MS + 1, T0)).toBe(true)
  })

  it('keeps a trip through a long quiet spell, but not forever', () => {
    const trip = ride({ status: 'ontrip' })
    expect(isRideStale(trip, T0 + RIDE_STALE_AFTER_MS + 1, T0)).toBe(false)
    expect(isRideStale(trip, T0 + ON_TRIP_STALE_AFTER_MS + 1, T0)).toBe(true)
  })

  it('falls back to the ride timestamp when no receipt time is given', () => {
    expect(isRideStale(ride(), T0 + RIDE_STALE_AFTER_MS + 1)).toBe(true)
  })
})

describe('on trip', () => {
  const trip = (overrides: Partial<RideData> = {}) =>
    ride({ status: 'ontrip', etaMinutes: 3, ...overrides })

  it('says ON TRIP without inventing a number when no trip ETA is known', () => {
    expect(computeEta(trip(), T0)).toEqual({ minutesRemaining: null, label: 'ON TRIP', overdue: false })
  })

  it('ignores the leftover pickup ETA', () => {
    expect(computeEta(trip({ etaMinutes: 3 }), T0).minutesRemaining).toBeNull()
  })

  it('counts the trip ETA down from the timestamp', () => {
    expect(computeEta(trip({ tripEtaMinutes: 20 }), T0).minutesRemaining).toBe(20)
    expect(computeEta(trip({ tripEtaMinutes: 20 }), T0 + 5 * MINUTE).minutesRemaining).toBe(15)
  })

  it('says ALMOST THERE near the end', () => {
    expect(computeEta(trip({ tripEtaMinutes: 2 }), T0).label).toBe('ALMOST THERE')
    expect(computeEta(trip({ tripEtaMinutes: 2 }), T0 + 3 * MINUTE).minutesRemaining).toBe(0)
  })

  it('drops the number once the trip ETA is well overdue', () => {
    const state = computeEta(trip({ tripEtaMinutes: 5 }), T0 + (5 + ETA_GRACE_MINUTES + 1) * MINUTE)
    expect(state).toEqual({ minutesRemaining: null, label: 'ON TRIP', overdue: true })
  })

  it('never draws the pickup range ring', () => {
    expect(rangeRingMinutes(trip({ tripEtaMinutes: 20 }), T0)).toBeNull()
  })

  it('gives the arrival time from the live trip ETA', () => {
    expect(tripArrivalTime(trip({ tripEtaMinutes: 20 }), T0)?.getTime()).toBe(T0 + 20 * MINUTE)
    expect(tripArrivalTime(trip(), T0)).toBeNull()
    expect(tripArrivalTime(ride({ tripEtaMinutes: 20 }), T0)).toBeNull()
  })

  it('prefers a reported route distance', () => {
    const d = tripDistance(trip({ tripRemainingMiles: 4.2, destinationLat: 37.8, destinationLng: -122.4 }))
    expect(d).toEqual({ miles: 4.2, straightLine: false })
    expect(formatTripDistance(d!)).toBe('4.2 mi left')
  })

  it('falls back to straight-line distance, and says so', () => {
    // 1 degree of latitude is ~69 miles
    const d = tripDistance(trip({ requesterLat: 37, requesterLng: -122, destinationLat: 38, destinationLng: -122 }))
    expect(d?.straightLine).toBe(true)
    expect(d!.miles).toBeCloseTo(69.1, 0)
    expect(formatTripDistance(d!)).toBe('~69.1 mi straight line')
  })

  it('measures from the car when its position is known', () => {
    const d = tripDistance(trip({
      requesterLat: 0, requesterLng: 0, // stale pickup point
      driverLat: 38, driverLng: -122,
      destinationLat: 38, destinationLng: -122
    }))
    expect(d!.miles).toBeCloseTo(0, 5)
  })

  it('has no trip distance before pickup or without data', () => {
    expect(tripDistance(ride({ tripRemainingMiles: 3 }))).toBeNull()
    expect(tripDistance(trip())).toBeNull()
  })

  it('maps you against the drop-off instead of the driver', () => {
    const points = mapPoints(trip({ requesterLat: 1, requesterLng: 2, driverLat: 3, driverLng: 4, destinationLat: 5, destinationLng: 6 }))
    expect(points).toEqual({ youLat: 3, youLng: 4, targetLat: 5, targetLng: 6, targetLabel: 'Drop-off' })
    expect(mapPoints(ride({ requesterLat: 1, requesterLng: 2, driverLat: 3, driverLng: 4 })).targetLabel).toBe('Driver')
  })

  it('formats a short clock time', () => {
    expect(formatClock(new Date(2026, 9, 14, 19, 5))).toBe('7:05 PM')
    expect(formatClock(new Date(2026, 9, 14, 0, 30))).toBe('12:30 AM')
  })
})

describe('isTerminalStatus', () => {
  it('classifies each status', () => {
    expect(isTerminalStatus('enroute')).toBe(false)
    expect(isTerminalStatus('arriving')).toBe(false)
    // Not terminal: the trip follows, and the card has to survive into it.
    expect(isTerminalStatus('arrived')).toBe(false)
    expect(isTerminalStatus('ontrip')).toBe(false)
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('cancelled')).toBe(true)
    expect(isTerminalStatus(undefined)).toBe(false)
  })
})

describe('mergeRide', () => {
  it('keeps driver details when a bare arrival notice comes in', () => {
    // This is the regression that motivated merging: "Your driver has arrived"
    // names nobody, and replacing wholesale blanked the card.
    const arrival: RideData = {
      status: 'arrived',
      driverName: '',
      driverRating: 0,
      vehicleMake: '',
      vehicleModel: '',
      vehicleColor: '',
      licensePlate: '',
      etaMinutes: 0,
      timestamp: new Date(T0 + 4 * MINUTE).toISOString()
    }

    const merged = mergeRide(ride(), arrival)

    expect(merged.status).toBe('arrived')
    expect(merged.driverName).toBe('John D.')
    expect(merged.vehicleMake).toBe('Toyota')
    expect(merged.licensePlate).toBe('ABC123')
    expect(merged.driverRating).toBe(4.9)
  })

  it('keeps driver details when a bare arriving notice comes in', () => {
    const arriving: RideData = {
      status: 'arriving',
      driverName: '',
      driverRating: 0,
      vehicleMake: '',
      vehicleModel: '',
      vehicleColor: '',
      licensePlate: '',
      etaMinutes: 0,
      timestamp: new Date(T0 + 2 * MINUTE).toISOString()
    }

    const merged = mergeRide(ride(), arriving)
    expect(merged.status).toBe('arriving')
    expect(merged.driverName).toBe('John D.')
    expect(merged.licensePlate).toBe('ABC123')
  })

  it('takes newer values when they are present', () => {
    const update = ride({ etaMinutes: 2, timestamp: new Date(T0 + MINUTE).toISOString() })
    const merged = mergeRide(ride(), update)
    expect(merged.etaMinutes).toBe(2)
    expect(merged.timestamp).toBe(update.timestamp)
  })

  it('preserves coordinates that a later update omits', () => {
    const withLocation = ride({ requesterLat: 37.7755, requesterLng: -122.418 })
    const merged = mergeRide(withLocation, ride({ etaMinutes: 2 }))
    expect(merged.requesterLat).toBe(37.7755)
    expect(merged.requesterLng).toBe(-122.418)
  })

  it('starts fresh when a different driver appears', () => {
    const other = ride({ driverName: 'Sarah M.', licensePlate: 'XYZ789', vehicleMake: 'Honda' })
    const merged = mergeRide(ride(), other)
    expect(merged.driverName).toBe('Sarah M.')
    expect(merged.licensePlate).toBe('XYZ789')
    expect(merged.vehicleMake).toBe('Honda')
  })

  it('returns the incoming ride when there is nothing to merge onto', () => {
    const r = ride()
    expect(mergeRide(null, r)).toEqual(r)
  })

  it('fills in the fields a sparse first update leaves out', () => {
    const sparse = { driverName: 'John D.', etaMinutes: 4, timestamp: ride().timestamp } as RideData
    expect(mergeRide(null, sparse)).toMatchObject({
      driverRating: 0, vehicleMake: '', vehicleModel: '', vehicleColor: '', licensePlate: ''
    })
  })

  it('re-bases a trip ETA that a later update does not restate', () => {
    const started = ride({ status: 'ontrip', tripEtaMinutes: 20, destinationName: 'SFO' })
    const later = ride({
      status: 'ontrip',
      tripRemainingMiles: 6,
      timestamp: new Date(T0 + 5 * MINUTE).toISOString()
    })
    const merged = mergeRide(started, later)
    expect(merged.tripEtaMinutes).toBe(15)
    expect(merged.destinationName).toBe('SFO')
    expect(merged.tripRemainingMiles).toBe(6)
    expect(computeEta(merged, T0 + 5 * MINUTE).minutesRemaining).toBe(15)
  })

  it('does not resurrect a zero ETA over a known one', () => {
    const merged = mergeRide(ride({ etaMinutes: 4 }), ride({ etaMinutes: 0 }))
    expect(merged.etaMinutes).toBe(4)
  })
})
