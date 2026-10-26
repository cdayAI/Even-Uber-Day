import { RideData, RideStatus, UNKNOWN_DRIVER } from './RideData'

/**
 * Turn text read off the Uber app — a screenshot run through iOS text
 * recognition, or a copied notification — into a ride update.
 *
 * Ported from the iOS companion's NotificationParser and extended for screen
 * text, which arrives as separate lines rather than sentences: the plate sits
 * alone on a line, the rating often loses its ★, and the trip screen talks
 * about "Heading to …" and "Drop-off by 7:42 PM" instead of minutes away.
 *
 * Heuristic by nature. Everything is optional; the caller shows what was found
 * before applying it.
 */

export interface ParsedUberText {
  update: Partial<RideData> & { status?: RideStatus }
  /** Human-readable list of what was recognised, for the confirmation line. */
  found: string[]
}

const KNOWN_COLORS = [
  'White', 'Silver', 'Black', 'Red', 'Blue', 'Gray', 'Grey', 'Green', 'Yellow',
  'Orange', 'Brown', 'Gold', 'Beige', 'Maroon'
]

const KNOWN_MAKES = [
  'Mercedes-Benz', 'Land Rover', 'Range Rover', 'Toyota', 'Honda', 'BMW', 'Mercedes',
  'Ford', 'Chevrolet', 'Chevy', 'Tesla', 'Volkswagen', 'VW', 'Audi', 'Lexus', 'Hyundai',
  'Kia', 'Nissan', 'Subaru', 'Mazda', 'Jeep', 'Dodge', 'Chrysler', 'GMC', 'Buick',
  'Cadillac', 'Acura', 'Infiniti', 'Volvo', 'Mitsubishi', 'Porsche', 'Genesis',
  'Lincoln', 'Ram', 'Fiat', 'Mini', 'Polestar', 'Rivian', 'Lucid'
]

/** Capitalised words that look like names but never are. */
const STOPWORDS = new Set([
  'your', 'uber', 'the', 'a', 'an', 'driver', 'arriving', 'arrived', 'meet', 'trip',
  'ride', 'on', 'at', 'in', 'is', 'has', 'pickup', 'pick', 'eta', 'estimated',
  'minutes', 'mins', 'min', 'away', 'heading', 'confirmed', 'cancelled', 'canceled',
  'uberx', 'uberxl', 'comfort', 'black', 'pool', 'share', 'reserve', 'please',
  'drop-off', 'dropoff', 'drop', 'off', 'contact', 'call', 'message', 'send',
  'safety', 'share', 'cancel', 'details', 'payment', 'cash', 'visa', 'now',
  'he', 'she', 'they', 'it', 'we', 'you', 'i', 'there', 'this', 'that', 'to', 'by'
])

const has = (haystack: string, needles: string[]) => needles.some((n) => haystack.includes(n))

export function extractStatus(text: string): RideStatus | undefined {
  const t = text.toLowerCase()

  if (has(t, ['cancelled', 'canceled', 'trip was called off'])) return 'cancelled'
  if (has(t, ['trip is complete', 'trip complete', 'trip completed', "you've arrived",
    'you have arrived', 'thanks for riding', 'rate your trip', 'rate your driver',
    'trip receipt', 'how was your trip', 'trip summary'])) return 'completed'
  // Pickup signals beat trip signals: the pickup screen often lists the
  // drop-off address too, so "drop-off" alone proves nothing.
  if (has(t, ['has arrived', 'is here', 'is waiting', 'arrived at', 'your driver is outside',
    'meet your driver outside'])) return 'arrived'
  if (has(t, ['is arriving now', 'arriving now', 'is pulling up', 'pulling up',
    'is almost there'])) return 'arriving'
  if (has(t, ['meet at', 'meet your driver', 'pickup in', 'pick-up in', 'min away',
    'mins away', 'minutes away', 'is on the way', 'on the way to you'])) return 'enroute'
  if (has(t, ['heading to', 'drop-off by', 'dropoff by', 'drop off by', 'arrive by',
    'arriving by', 'trip has started', 'your trip has begun', 'enjoy your ride',
    "you're on your way", 'you are on your way', 'en route to'])) return 'ontrip'
  return undefined
}

function stripLeadingStopwords(candidate: string): string {
  const tokens = candidate.trim().split(/\s+/)
  while (tokens.length && STOPWORDS.has(tokens[0].toLowerCase())) tokens.shift()
  return tokens.join(' ')
}

const NAME = String.raw`([A-Z][a-z]+(?:\s+[A-Z][a-z]*\.?)?)`

export function extractDriverName(text: string, lines: string[]): string {
  const patterns = [
    new RegExp(String.raw`(?:[Yy]our\s+driver|[Dd]river),?\s+` + NAME, 'g'),
    new RegExp(String.raw`\b[Mm]eet\s+` + NAME, 'g'),
    new RegExp(NAME + String.raw`\s*\(?\s*[0-9]\.[0-9]{1,2}\s*[★*]`, 'g'),
    new RegExp(NAME + String.raw`\s+(?:is|has|will)\b`, 'g'),
    new RegExp(NAME + String.raw`\s+(?:arriving|approaching)\b`, 'g')
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = stripLeadingStopwords(match[1])
      if (name && !isMakeOrColor(name)) return name
    }
  }

  // Screen layout: the name sits alone on the line just above the rating.
  const ratingLine = lines.findIndex((l) => /^[0-9]\.[0-9]{1,2}\s*[★*]?$/.test(l))
  if (ratingLine > 0) {
    const above = lines[ratingLine - 1]
    if (/^[A-Z][a-z]+(?:\s+[A-Z]\.?)?$/.test(above) && !STOPWORDS.has(above.toLowerCase()) && !isMakeOrColor(above)) {
      return above
    }
  }
  return ''
}

function isMakeOrColor(word: string): boolean {
  const w = word.toLowerCase()
  return KNOWN_MAKES.some((m) => m.toLowerCase() === w) || KNOWN_COLORS.some((c) => c.toLowerCase() === w)
}

export function extractRating(text: string, lines: string[]): number {
  const patterns = [
    /([0-9]\.[0-9]{1,2})\s*[★*]/,
    /\(\s*([0-9]\.[0-9]{1,2})\s*[★*]?\s*\)/,
    /([0-9]\.[0-9]{1,2})\s*stars?/i,
    /rated\s+([0-9]\.[0-9]{1,2})/i
  ]
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) {
      const rating = Number(m[1])
      if (rating >= 1 && rating <= 5) return rating
    }
  }
  // A bare "4.92" alone on a line is the rating on the driver card.
  for (const line of lines) {
    const m = line.match(/^([0-9]\.[0-9]{1,2})$/)
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 5) return Number(m[1])
  }
  return 0
}

export function extractVehicle(text: string): { make: string; model: string; color: string } {
  for (const make of KNOWN_MAKES) {
    const escaped = make.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
    const m = new RegExp(String.raw`\b(` + escaped + String.raw`)\b(?:[ \t]+([A-Za-z][A-Za-z0-9-]*(?:[ \t]+[0-9][A-Za-z0-9-]*)?))?`, 'i').exec(text)
    if (!m) continue
    const model = m[2] && !STOPWORDS.has(m[2].toLowerCase().split(/\s+/)[0]) ? m[2] : ''
    return { make: m[1], model, color: colorBefore(text, m.index) }
  }
  return { make: '', model: '', color: colorBefore(text, undefined) }
}

function colorBefore(text: string, makeIndex: number | undefined): string {
  let best: { at: number; color: string } | null = null
  for (const color of KNOWN_COLORS) {
    const m = new RegExp(String.raw`\b` + color + String.raw`\b`, 'i').exec(text)
    if (!m) continue
    if (makeIndex !== undefined && m.index >= makeIndex) continue
    if (!best || m.index > best.at) best = { at: m.index, color }
  }
  return best?.color ?? ''
}

export function extractPlate(text: string, lines: string[]): string {
  const patterns = [
    /\(([A-Z0-9][A-Z0-9\- ]{1,8})\)/g,
    /\[([A-Z0-9][A-Z0-9\- ]{1,8})\]/g,
    /(?:plate|licen[cs]e plate)\s*:?\s*([A-Z0-9][A-Z0-9-]{1,8})/gi
  ]
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const plate = m[1].trim()
      if (/[A-Z]/.test(plate) && /[0-9]/.test(plate)) return plate
    }
  }
  // Screen layout: the plate is its own line, letters and digits mixed.
  for (const line of lines) {
    const candidate = line.replace(/\s+/g, ' ').trim()
    if (/^[A-Z0-9]{2,4}[ -]?[A-Z0-9]{2,5}$/.test(candidate) && /[A-Z]/.test(candidate) && /[0-9]/.test(candidate)) {
      return candidate
    }
  }
  return ''
}

export function extractMinutes(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*(?:mins?|minutes?)\b/i)
  if (!m) return undefined
  const minutes = Number(m[1])
  return minutes > 0 && minutes < 600 ? minutes : undefined
}

/** "7:42 PM" → minutes from `now` until then (next occurrence), if within 6 hours. */
export function extractClockMinutes(text: string, now: number): number | undefined {
  const m = text.match(/\b(\d{1,2}):(\d{2})\s*([AaPp])\.?\s*[Mm]\.?/)
  if (!m) return undefined
  let hours = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'p') hours += 12
  const target = new Date(now)
  target.setHours(hours, Number(m[2]), 0, 0)
  let diff = (target.getTime() - now) / 60_000
  if (diff < -60) diff += 24 * 60 // just past midnight
  if (diff < 0 || diff > 6 * 60) return undefined
  return Math.round(diff)
}

export function extractDestination(text: string, lines: string[]): string {
  const inline = text.match(/(?:heading to|en route to|drop-?off at|dropping off at)\s+([^\n·•|]{3,60})/i)
  if (inline) return inline[1].trim().replace(/[.,]$/, '')

  // "Drop-off" / "Destination" as a label with the place on the next line.
  const label = lines.findIndex((l) => /^(drop-?off|destination|to)$/i.test(l))
  if (label >= 0 && lines[label + 1] && !/\d{1,2}:\d{2}/.test(lines[label + 1])) {
    return lines[label + 1]
  }
  return ''
}

export function parseUberText(text: string, now: number = Date.now()): ParsedUberText {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const flat = lines.join('\n')

  const status = extractStatus(flat)
  const driverName = extractDriverName(flat, lines)
  const driverRating = extractRating(flat, lines)
  const vehicle = extractVehicle(flat)
  const licensePlate = extractPlate(flat, lines)
  const minutes = extractMinutes(flat)

  const update: ParsedUberText['update'] = { timestamp: new Date(now).toISOString() }
  const found: string[] = []

  if (status) update.status = status
  if (driverName) { update.driverName = driverName; found.push(driverName) }
  if (driverRating) { update.driverRating = driverRating; found.push(`★${driverRating}`) }
  if (vehicle.make) {
    update.vehicleMake = vehicle.make
    update.vehicleModel = vehicle.model
    update.vehicleColor = vehicle.color
    found.push([vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' '))
  }
  if (licensePlate) { update.licensePlate = licensePlate; found.push(`plate ${licensePlate}`) }

  if (status === 'ontrip') {
    const tripEta = minutes ?? extractClockMinutes(flat, now)
    if (tripEta !== undefined) { update.tripEtaMinutes = tripEta; found.push(`${tripEta} min to drop-off`) }
    const destination = extractDestination(flat, lines)
    if (destination) { update.destinationName = destination; found.push(`to ${destination}`) }
  } else if (minutes !== undefined) {
    update.etaMinutes = minutes
    found.push(`${minutes} min to pickup`)
  }

  const STATUS_LABEL: Record<RideStatus, string> = {
    enroute: 'ON THE WAY', arriving: 'ARRIVING', arrived: 'ARRIVED',
    ontrip: 'ON TRIP', completed: 'TRIP COMPLETE', cancelled: 'CANCELLED'
  }
  if (status && status !== 'enroute') found.unshift(STATUS_LABEL[status])
  return { update, found }
}

/**
 * The update to apply for a paste.
 *
 * A first paste may come from any screen — mid-trip included — and may not
 * name the driver or give a time. The store only starts a ride from a named
 * update with an ETA, so fill those in with values that claim nothing: a
 * stand-in name, and an unknown (not zero — zero reads ARRIVING) ETA.
 */
export function pasteUpdate(update: ParsedUberText['update'], hasActiveRide: boolean): RideData {
  const ride = { ...update } as RideData
  if (!hasActiveRide) {
    ride.driverName ||= UNKNOWN_DRIVER
    if (ride.etaMinutes === undefined) ride.etaMinutes = null
    ride.status ??= 'enroute'
  }
  return ride
}
