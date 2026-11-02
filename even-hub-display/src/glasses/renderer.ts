import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { glassesLog } from './log'
import { RideData } from '../models/RideData'
import { mapPoints, rangeRingMinutes } from '../models/rideTiming'
import { acquireBridge } from './bridge'
import { CONTAINERS, ContainerKey } from './constants'
import { GlassesText, diffText, formatIdle, formatRide } from './format'
import { buildPageLayout, validateLayout } from './layout'
import { renderMapBytes } from './rasterize'

/**
 * How often the page is re-derived with no new data.
 *
 * The ETA counts down from the ride's timestamp, so the minutes change while
 * nothing new arrives — and on the phone nothing may arrive for the whole wait
 * for pickup. A refresh only sends the lines that actually changed.
 */
const REFRESH_MS = 10_000

/**
 * Pushes ride data to the G2 glasses.
 *
 * Lifecycle: `start()` once (creates the page), then `update()` on every ride
 * change, then `stop()` on teardown. Text is diffed so only changed lines cross
 * the Bluetooth link, and the map image is only re-sent when the coordinates or
 * ETA actually move.
 *
 * Every method is safe to call when there is no bridge — outside the Even App
 * this object quietly does nothing and the page behaves like a normal web app.
 */
export class GlassesRenderer {
  private bridge: EvenAppBridge | null = null
  private started = false
  private lastText: GlassesText = {}
  private lastMapKey = ''
  private unsubscribeEvents: (() => void) | null = null
  /** The latest ride, kept so the page can be painted once it exists. */
  private ride: RideData | null = null
  private painting: Promise<void> = Promise.resolve()
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  /** Bumped by `stop()`, so a `start()` still waiting on the host knows to give up. */
  private generation = 0

  get isActive(): boolean {
    return this.started && this.bridge !== null
  }

  /** Create the glasses page. Returns false when running outside Even App. */
  async start(): Promise<boolean> {
    if (this.started) return this.isActive
    this.started = true

    // React StrictMode mounts, unmounts and remounts in dev, so `stop()` can
    // land while we're still waiting here. Carrying on would leave an orphan
    // renderer fighting the live one over the same page.
    const generation = this.generation
    const stopped = () => generation !== this.generation

    const bridge = await acquireBridge()
    if (!bridge || stopped()) return false
    this.bridge = bridge

    const layout = buildPageLayout()
    const errors = validateLayout(layout)
    if (errors.length > 0) {
      // Fail loudly here — the SDK would only answer `invalid`, with no detail.
      glassesLog('error', '❌ Invalid glasses layout', errors)
      this.bridge = null
      return false
    }

    try {
      // The SDK's methods take class instances, not the plain object literals
      // its README shows — they carry a `toJson` used on the way to native.
      // `layout.ts` stays SDK-free so it can be validated without a bridge; the
      // conversion happens here, at the boundary.
      const {
        CreateStartUpPageContainer,
        ImageContainerProperty,
        RebuildPageContainer,
        StartUpPageCreateResult,
        TextContainerProperty
      } = await import('@evenrealities/even_hub_sdk')

      const page = {
        containerTotalNum: layout.containerTotalNum,
        textObject: layout.textObject.map((t) => new TextContainerProperty(t)),
        imageObject: layout.imageObject.map((i) => new ImageContainerProperty(i))
      }

      const result = await bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer(page)
      )
      if (stopped()) return false

      if (result !== StartUpPageCreateResult.success) {
        // The host allows one startup page per app session and answers
        // `invalid` to any further create — which every page reload (and React
        // StrictMode's double mount) triggers. Replace the existing page instead.
        const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(page))
        if (stopped()) return false
        if (!rebuilt) {
          glassesLog('error', '❌ Glasses page create and rebuild both failed', result)
          this.bridge = null
          return false
        }
        glassesLog('info', '♻️ Startup page already existed — rebuilt it')
      }
    } catch (error) {
      glassesLog('error', '❌ Could not create the glasses page', error)
      this.bridge = null
      return false
    }

    glassesLog('info', '🕶️ Glasses page created')
    await this.listenForGestures()
    if (stopped()) return false

    // Paint whatever ride is already known — it often loads before the bridge
    // does — rather than the idle screen. Force a full paint.
    this.lastText = {}
    this.refreshTimer = setInterval(() => void this.paint(), REFRESH_MS)
    await this.paint()
    return true
  }

  /** Push a ride (or the idle screen when null). Kept until the page exists. */
  update(ride: RideData | null, now?: number): Promise<void> {
    this.ride = ride
    return this.paint(now)
  }

  /**
   * Paint the latest ride. Serialised, because each paint awaits the bridge
   * line by line and an overlapping one could finish late and put older text
   * back over newer.
   */
  private paint(now?: number): Promise<void> {
    this.painting = this.painting
      .then(() => this.draw(now ?? Date.now()))
      .catch((error) => glassesLog('warn', '⚠️ Glasses paint failed', error))
    return this.painting
  }

  private async draw(now: number): Promise<void> {
    const bridge = this.bridge
    if (!bridge) return

    const ride = this.ride
    const next = ride ? formatRide(ride, now) : formatIdle()
    const changed = diffText(this.lastText, next)

    for (const key of Object.keys(changed) as ContainerKey[]) {
      const container = CONTAINERS[key]
      if (!container || key === 'map') continue

      try {
        const { TextContainerUpgrade } = await import('@evenrealities/even_hub_sdk')
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: container.id,
            containerName: container.name,
            content: changed[key] ?? ''
          })
        )
      } catch (error) {
        glassesLog('warn', `⚠️ Failed to update "${container.name}":`, error)
      }
    }

    this.lastText = next
    await this.updateMap(ride, now)
  }

  /**
   * Re-send the map only when its inputs change — it is by far the most
   * expensive thing we transmit.
   */
  private async updateMap(ride: RideData | null, now: number): Promise<void> {
    if (!this.bridge) return

    const rangeMinutes = ride ? rangeRingMinutes(ride, now) ?? undefined : undefined
    const points = ride ? mapPoints(ride) : null

    // Rounded to ~10 m: GPS jitter must not re-send the most expensive
    // payload over Bluetooth every few seconds.
    const round = (v?: number) => (v === undefined ? '' : v.toFixed(4))
    const key = points
      ? [round(points.youLat), round(points.youLng), round(points.targetLat), round(points.targetLng), rangeMinutes].join(',')
      : 'idle'

    if (key === this.lastMapKey) return
    this.lastMapKey = key

    const bytes = points
      ? renderMapBytes({
          requesterLat: points.youLat,
          requesterLng: points.youLng,
          driverLat: points.targetLat,
          driverLng: points.targetLng,
          rangeMinutes
        })
      : null

    if (!bytes) return

    try {
      const { ImageRawDataUpdate, ImageRawDataUpdateResult } = await import(
        '@evenrealities/even_hub_sdk'
      )
      const result = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({
          containerID: CONTAINERS.map.id,
          containerName: CONTAINERS.map.name,
          imageData: bytes
        })
      )

      if (result !== ImageRawDataUpdateResult.success) {
        glassesLog('warn', '⚠️ Map image update failed', result)
      }
    } catch (error) {
      glassesLog('warn', '⚠️ Map image update threw', error)
    }
  }

  /**
   * Double-tap on the glasses closes the app, as it does in every other G2 app.
   * Without a listener the gesture did nothing and the card had no way off.
   */
  private async listenForGestures(): Promise<void> {
    if (!this.bridge) return
    const { OsEventTypeList } = await import('@evenrealities/even_hub_sdk')

    this.unsubscribeEvents?.()
    this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
      // Protobuf omits zero-value fields, so a plain tap (0) arrives with no
      // eventType. Coalesce only when the envelope exists.
      const sysType = event.sysEvent != null ? (event.sysEvent.eventType ?? 0) : null
      const textType = event.textEvent != null ? (event.textEvent.eventType ?? 0) : null

      if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        glassesLog('info', '👋 App closed by the system')
        this.detach()
        return
      }

      if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        glassesLog('info', '👋 Double-tap — closing')
        const bridge = this.bridge
        this.detach()
        void bridge?.shutDownPageContainer(1)
      }
    })
  }

  /** Stop listening and stop pushing updates, without touching the page. */
  private detach(): void {
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = null
    this.stopRefresh()
    this.bridge = null
  }

  private stopRefresh(): void {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  /** Close the glasses page. */
  async stop(): Promise<void> {
    this.generation += 1
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = null
    this.stopRefresh()
    if (this.bridge) {
      try {
        await this.bridge.shutDownPageContainer(0)
      } catch (error) {
        glassesLog('warn', '⚠️ Failed to close the glasses page', error)
      }
    }
    this.bridge = null
    this.started = false
    this.lastText = {}
    this.lastMapKey = ''
  }
}
