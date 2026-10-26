import { describe, expect, it } from 'vitest'
import { formatRide } from '../glasses/format'
import { UNKNOWN_DRIVER } from './RideData'
import { RideStore, StoredRide } from './rideStore'
import { computeEta } from './rideTiming'
import { extractClockMinutes, extractStatus, parseUberText, pasteUpdate } from './uberText'

// 2026-10-15 19:00 local time
const NOW = new Date(2026, 9, 15, 19, 0, 0).getTime()

describe('parseUberText — pickup screen', () => {
  const screen = [
    'Meet at the pickup point',
    '3 min',
    'John',
    '4.92',
    'Silver Toyota Prius',
    '8ABC123',
    'Send a message',
    'Drop-off',
    'SFO Terminal 2'
  ].join('\n')

  it('reads driver, rating, car, plate and pickup ETA', () => {
    const { update } = parseUberText(screen, NOW)
    expect(update).toMatchObject({
      status: 'enroute',
      driverName: 'John',
      driverRating: 4.92,
      vehicleMake: 'Toyota',
      vehicleModel: 'Prius',
      vehicleColor: 'Silver',
      licensePlate: '8ABC123',
      etaMinutes: 3
    })
  })

  it('does not mistake the listed drop-off for being on the trip', () => {
    expect(parseUberText(screen, NOW).update.status).toBe('enroute')
    expect(parseUberText(screen, NOW).update.tripEtaMinutes).toBeUndefined()
  })
})

describe('parseUberText — trip screen', () => {
  it('reads destination and minutes left', () => {
    const { update } = parseUberText('Heading to SFO Terminal 2\n24 min\nJohn\nSilver Toyota Prius', NOW)
    expect(update).toMatchObject({ status: 'ontrip', destinationName: 'SFO Terminal 2', tripEtaMinutes: 24 })
    expect(update.etaMinutes).toBeUndefined()
  })

  it('turns a drop-off clock time into minutes left', () => {
    const { update } = parseUberText('Drop-off by 7:42 PM\nSFO Terminal 2', NOW)
    expect(update).toMatchObject({ status: 'ontrip', tripEtaMinutes: 42 })
  })

  it('reads a destination given under a label', () => {
    const { update } = parseUberText('Arrive by 7:30 PM\nDrop-off\n1 Market St', NOW)
    expect(update.destinationName).toBe('1 Market St')
  })
})

describe('parseUberText — notifications', () => {
  it('reads the classic notification sentence', () => {
    const { update } = parseUberText('John D. is 3 mins away in a Silver Toyota Prius (ABC123)', NOW)
    expect(update).toMatchObject({
      status: 'enroute', driverName: 'John D.', vehicleMake: 'Toyota', licensePlate: 'ABC123', etaMinutes: 3
    })
  })

  it('classifies lifecycle wording', () => {
    expect(extractStatus('Your driver has arrived')).toBe('arrived')
    expect(extractStatus('Your driver is arriving now')).toBe('arriving')
    expect(extractStatus('Your trip has started')).toBe('ontrip')
    expect(extractStatus('Rate your trip with John')).toBe('completed')
    expect(extractStatus('Your ride was cancelled')).toBe('cancelled')
    expect(extractStatus('Hello')).toBeUndefined()
  })

  it('never names the driver "Your Uber" or a car make', () => {
    expect(parseUberText('Your Uber is arriving now', NOW).update.driverName).toBeUndefined()
    expect(parseUberText('Toyota is here', NOW).update.driverName).toBeUndefined()
  })
})

describe('extractClockMinutes', () => {
  it('handles AM/PM and ignores far-off or past times', () => {
    expect(extractClockMinutes('Arrive by 8:15 PM', NOW)).toBe(75)
    expect(extractClockMinutes('Arrive by 7:05 p.m.', NOW)).toBe(5)
    expect(extractClockMinutes('Arrive by 6:00 AM', NOW)).toBeUndefined()
    expect(extractClockMinutes('no time here', NOW)).toBeUndefined()
  })
})

describe('pasting into the app', () => {
  // What PasteFromUber does: parse, fill in a first paste, apply.
  function paste(store: RideStore, text: string, now: number) {
    const { update } = parseUberText(text, now)
    return store.apply(pasteUpdate(update, store.current(now) !== null), now)
  }

  it('starts a complete ride from a trip screen with no driver card', () => {
    // Pasted as the first paste, this left the rating undefined; the phone card
    // threw on it, and the persisted ride kept the app blank on every reopen.
    const store = new RideStore()
    paste(store, 'Heading to SFO Terminal 2\n12 min', NOW)
    const ride = store.current(NOW)!
    expect(ride).toMatchObject({
      status: 'ontrip', driverName: UNKNOWN_DRIVER, driverRating: 0,
      vehicleMake: '', vehicleModel: '', vehicleColor: '', licensePlate: ''
    })
    expect(formatRide(ride, NOW).vehicle).toBe('Vehicle details pending')
  })

  it('does not claim the driver is arriving when the screen gave no time', () => {
    const store = new RideStore()
    paste(store, 'Meet at the pickup point\nJohn\n4.92\nSilver Toyota Prius\n8ABC123', NOW)
    const ride = store.current(NOW)!
    expect(computeEta(ride, NOW)).toEqual({ minutesRemaining: null, label: 'ON THE WAY', overdue: false })
    expect(formatRide(ride, NOW).eta).toBe('--')
  })

  it('keeps what the first paste found when a later one names the driver', () => {
    const store = new RideStore()
    paste(store, 'Meet at the pickup point\n4 min\nSilver Toyota Prius\n8ABC123', NOW)
    paste(store, 'Meet at the pickup point\n3 min\nMaria\n4.95', NOW + 60_000)
    expect(store.current(NOW + 60_000)).toMatchObject({
      driverName: 'Maria', driverRating: 4.95, vehicleMake: 'Toyota', licensePlate: '8ABC123', etaMinutes: 3
    })
  })

  it('repairs a ride persisted by an earlier version', () => {
    const saved = {
      ride: { status: 'ontrip', driverName: UNKNOWN_DRIVER, etaMinutes: 0, timestamp: new Date(NOW).toISOString() },
      receivedAt: NOW
    } as unknown as StoredRide
    expect(new RideStore(saved).current(NOW)).toMatchObject({ driverRating: 0, vehicleMake: '', licensePlate: '' })
  })
})
