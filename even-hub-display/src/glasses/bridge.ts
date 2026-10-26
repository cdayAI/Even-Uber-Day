import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { glassesLog } from './log'

/**
 * Acquiring the Even App bridge, safely.
 *
 * The SDK only works inside the Even App's WebView, where the host injects
 * `window.flutter_inappwebview.callHandler`. In an ordinary browser —
 * `npm run dev`, or the 576×288 preview — that object is absent, yet SDK
 * 0.0.16's `waitForEvenAppBridge()` still resolves at once (seen in Chromium).
 * Every call on it then logs "Flutter handler not available" and page creation
 * comes back invalid, which is what turns glasses output off there. The
 * timeout below is for a host that never reports ready: the display must
 * degrade to a plain web page rather than hang.
 */

declare global {
  interface Window {
    flutter_inappwebview?: { callHandler?: unknown }
  }
}

const BRIDGE_TIMEOUT_MS = 5000

/** True when running inside the Even App WebView. */
export function isEvenAppWebView(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.flutter_inappwebview?.callHandler !== 'undefined'
  )
}

let pending: Promise<EvenAppBridge | null> | null = null

/**
 * Resolve the bridge, or null when unavailable.
 *
 * Never throws and never hangs — callers treat null as "run as a web page".
 * Shared: the glasses renderer and the location hook both need it, and
 * there's only one host to wait for.
 */
export function acquireBridge(): Promise<EvenAppBridge | null> {
  pending ??= connect()
  return pending
}

async function connect(): Promise<EvenAppBridge | null> {
  // The host may inject `flutter_inappwebview` after our first script runs, so
  // its absence at startup is not proof we're in a plain browser. Always wait
  // (bounded by the timeout) rather than bailing on an early check.
  glassesLog('info', '🔌 Acquiring Even App bridge', {
    webViewAtStartup: isEvenAppWebView(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
  })

  try {
    const { waitForEvenAppBridge } = await import('@evenrealities/even_hub_sdk')

    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), BRIDGE_TIMEOUT_MS)
    )

    const bridge = await Promise.race([waitForEvenAppBridge(), timeout])

    if (!bridge) {
      glassesLog('info', `ℹ️ No Even App bridge within ${BRIDGE_TIMEOUT_MS}ms — glasses output disabled`, {
        webViewNow: isEvenAppWebView()
      })
      return null
    }

    glassesLog('info', '✅ Even App bridge ready')
    return bridge
  } catch (error) {
    glassesLog('warn', '⚠️ Failed to load the Even Hub SDK', error)
    return null
  }
}
