const EARTH_RADIUS_MILES = 3958.8

/** A coordinate of exactly 0 is valid (Gulf of Guinea) — don't treat it as absent. */
export function isCoord(value?: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Great-circle distance in miles.
 *
 * The previous implementation treated a degree of longitude as equal to a
 * degree of latitude, which overstates east-west distance by ~21% at San
 * Francisco's latitude and by more the further from the equator you go.
 */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`
  return `${miles.toFixed(1)} mi`
}
