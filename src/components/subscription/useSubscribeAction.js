import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''

export function useSubscribeAction() {
  const [loading, setLoading] = useState(false)

  async function subscribe() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ app_url: window.location.origin }),
      })
      const json = await res.json()
      if (json.url) window.location.href = json.url
    } catch (e) {
      console.error('Subscribe error:', e)
    } finally {
      setLoading(false)
    }
  }

  return { subscribe, loading }
}
