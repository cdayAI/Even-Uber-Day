import { Component, ReactNode } from 'react'
import { clearRide } from '../rideSource'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Last line of defence for the phone UI.
 *
 * The active ride is persisted, so a ride the UI can't render crashes it again
 * on every reopen until the ride expires — up to two hours on a trip. Show
 * what went wrong and a way out, rather than a blank page.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  private reset = async () => {
    await clearRide('local')
    // Harmless when there's no dev server; clears its copy when there is.
    await clearRide('server').catch(() => {})
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="status-view">
        <div className="status-content">
          <h2>Something went wrong</h2>
          <p className="status-detail">{this.state.error.message}</p>
          <button className="nav-btn" onClick={() => void this.reset()}>
            Clear the current ride
          </button>
        </div>
      </div>
    )
  }
}
