import { formatRating } from '../models/RideData'

export interface DriverInfoProps {
  name: string
  rating: number
  vehicle: string
  plate: string
}

/**
 * Display driver name, rating, vehicle info, and license plate
 * Optimized for 576x288 green monochrome display
 */
export default function DriverInfo({ name, rating, vehicle, plate }: DriverInfoProps) {
  // Same fallbacks as the glasses, so the two never disagree about what's known.
  const car = vehicle.replace(/\s+/g, ' ').trim()

  return (
    <div className="driver-info">
      <div className="driver-name-rating">
        <h1>{name}</h1>
        {rating > 0 && <div className="rating">⭐ {formatRating(rating)}</div>}
      </div>

      <div className="vehicle-info">
        <p className="vehicle-type">{car || 'Vehicle details pending'}</p>
        <p className="license-plate">📋 {plate || 'N/A'}</p>
      </div>
    </div>
  )
}
