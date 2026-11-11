import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// A new page starts at the top. The router keeps the scroll position across
// pages, so without this a long page's scroll carried into the next one and
// its title and main action opened off screen.
export function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}
