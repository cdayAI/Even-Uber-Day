import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RideData } from '../models/RideData'
import { CONTAINERS } from './constants'

/**
 * A stand-in for the Even App bridge that records what reaches the glasses.
 * Resolution is held back until the test releases it, so we can reproduce the
 * real ordering: the ride often loads before the host hands us the bridge.
 */
let releaseBridge: (bridge: unknown) => void = () => {}
const sent: Record<string, string> = {}

const fakeBridge = {
  createStartUpPageContainer: vi.fn(async () => 0),
  rebuildPageContainer: vi.fn(async () => true),
  textContainerUpgrade: vi.fn(async (u: { containerName: string; content: string }) => {
    sent[u.containerName] = u.content
    return true
  }),
  updateImageRawData: vi.fn(async () => 0),
  onEvenHubEvent: vi.fn(() => () => {}),
  shutDownPageContainer: vi.fn(async () => true)
}

vi.mock('./bridge', () => ({
  acquireBridge: () => new Promise((resolve) => { releaseBridge = resolve })
}))

const { GlassesRenderer } = await import('./renderer')

const T0 = Date.parse('2026-08-17T12:00:00Z')

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

beforeEach(() => {
  for (const key of Object.keys(sent)) delete sent[key]
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GlassesRenderer', () => {
  it('paints a ride that arrived before the bridge did', async () => {
    const renderer = new GlassesRenderer()
    const starting = renderer.start()

    // The ride loads first — restored from storage on reopen — before the
    // host has handed over the bridge. Nothing can be sent yet.
    await renderer.update(ride())
    releaseBridge(fakeBridge)
    await starting

    expect(sent[CONTAINERS.driver.name]).toBe('John D. ★4.9')
    expect(sent[CONTAINERS.eta.name]).toBe('5 MIN')
    await renderer.stop()
  })

  it('counts the ETA down with no new data', async () => {
    // On the phone the ride object only changes when the user pastes again, so
    // nothing upstream prompts a repaint for the whole wait.
    const renderer = new GlassesRenderer()
    const starting = renderer.start()
    releaseBridge(fakeBridge)
    await starting
    await renderer.update(ride())
    expect(sent[CONTAINERS.eta.name]).toBe('5 MIN')

    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(sent[CONTAINERS.eta.name]).toBe('3 MIN')
    await renderer.stop()
  })

  it('only re-sends lines that changed on a refresh', async () => {
    const renderer = new GlassesRenderer()
    const starting = renderer.start()
    releaseBridge(fakeBridge)
    await starting
    await renderer.update(ride())
    fakeBridge.textContainerUpgrade.mockClear()

    await vi.advanceTimersByTimeAsync(10_000)
    expect(fakeBridge.textContainerUpgrade).not.toHaveBeenCalled()
    await renderer.stop()
  })

  it('does not take the page over after being stopped mid-start', async () => {
    const renderer = new GlassesRenderer()
    const starting = renderer.start()
    await renderer.stop()

    releaseBridge(fakeBridge)
    expect(await starting).toBe(false)
    expect(fakeBridge.createStartUpPageContainer).not.toHaveBeenCalled()
    expect(fakeBridge.textContainerUpgrade).not.toHaveBeenCalled()
  })
})
