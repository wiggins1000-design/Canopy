import { useEffect } from 'react'

const BASE_URL = 'https://parentingplan.help'

// Updates the per-route <title>/canonical/description/robots tags that
// index.html seeds statically — this is a single-page app, so every route
// otherwise shares the homepage's tags (including its canonical, which
// would tell Google every other route is a duplicate of "/").
export function useSeo({ title, description, path = '/', noindex = false }) {
  useEffect(() => {
    if (title) document.title = title

    const canonicalUrl = `${BASE_URL}${path}`
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonicalUrl)

    if (description) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', description)
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
      document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', description)
    }

    document.querySelector('meta[name="robots"]')?.setAttribute('content', noindex ? 'noindex, follow' : 'index, follow')

    if (title) {
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
      document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', title)
    }
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonicalUrl)
  }, [title, description, path, noindex])
}
