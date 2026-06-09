// Canopy — Supabase Edge Function: calendar-oauth-callback
//
// Handles the OAuth callback from Google or Outlook after the user authorises
// calendar access. Exchanges the auth code for tokens and stores them.
//
// ── OAuth app setup ───────────────────────────────────────────────────────────
//   Google: console.cloud.google.com → Create project → APIs & Services →
//     Enable "Google Calendar API" → OAuth 2.0 Client ID (Web application)
//     Authorised redirect URI: https://<supabase-ref>.supabase.co/functions/v1/calendar-oauth-callback
//
//   Outlook: portal.azure.com → App registrations → New registration
//     Redirect URI: https://<supabase-ref>.supabase.co/functions/v1/calendar-oauth-callback
//     API permissions: Calendars.ReadWrite (Microsoft Graph)
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET
//   APP_URL (e.g. https://canopy-production-4239.up.railway.app)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy calendar-oauth-callback --no-verify-jwt --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const FUNCTION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/calendar-oauth-callback`
const APP_URL      = Deno.env.get('APP_URL') ?? 'https://canopy-production-4239.up.railway.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url      = new URL(req.url)
  const code     = url.searchParams.get('code')
  const state    = url.searchParams.get('state')   // provider|userId|syncTypes
  const errorMsg = url.searchParams.get('error')

  if (errorMsg) {
    return redirect(`${APP_URL}/config?calendar_error=${encodeURIComponent(errorMsg)}`)
  }
  if (!code || !state) {
    return redirect(`${APP_URL}/config?calendar_error=missing_params`)
  }

  const [provider, userId, syncTypesEncoded] = state.split('|')
  const syncTypes = syncTypesEncoded ? JSON.parse(decodeURIComponent(syncTypesEncoded)) : ['events', 'schedule_changes']

  try {
    let tokens: TokenResponse
    let calendarId: string | null = null

    if (provider === 'google') {
      tokens = await exchangeGoogleCode(code)
      calendarId = await getGooglePrimaryCalendar(tokens.access_token)
    } else if (provider === 'outlook') {
      tokens = await exchangeOutlookCode(code)
      calendarId = await getOutlookPrimaryCalendar(tokens.access_token)
    } else {
      return redirect(`${APP_URL}/config?calendar_error=unknown_provider`)
    }

    // Store tokens — use service role to bypass RLS since we know the user from state
    await supabase.rpc('upsert_calendar_connection', {
      p_provider:      provider,
      p_access_token:  tokens.access_token,
      p_refresh_token: tokens.refresh_token ?? null,
      p_token_expiry:  tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      p_calendar_id:   calendarId,
      p_sync_types:    syncTypes,
    })

    // We can't call the RPC as the user because we have no JWT here; use service role directly
    const { data: memberRow } = await supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', userId)
      .single()

    if (memberRow) {
      await supabase.from('calendar_connections').upsert({
        user_id:       userId,
        family_id:     memberRow.family_id,
        provider,
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        token_expiry:  tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : null,
        calendar_id:   calendarId,
        sync_types:    syncTypes,
        is_active:     true,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id,provider' })
    }

    return redirect(`${APP_URL}/config?calendar_connected=${provider}`)
  } catch (e: any) {
    console.error('OAuth callback error:', e)
    return redirect(`${APP_URL}/config?calendar_error=${encodeURIComponent(e.message ?? 'unknown')}`)
  }
})

// ── Google ─────────────────────────────────────────────────────────────────

async function exchangeGoogleCode(code: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      redirect_uri:  FUNCTION_URL,
      grant_type:    'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  return res.json()
}

async function getGooglePrimaryCalendar(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return 'primary'
  const data = await res.json()
  return data.id ?? 'primary'
}

// ── Outlook ────────────────────────────────────────────────────────────────

async function exchangeOutlookCode(code: string): Promise<TokenResponse> {
  const clientId = Deno.env.get('OUTLOOK_CLIENT_ID')!
  // 'consumers' = personal Microsoft accounts only (Outlook.com, Hotmail, Live.com)
  // Work/school accounts require Azure publisher verification — tracked for future
  const tenantId = 'consumers'
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: Deno.env.get('OUTLOOK_CLIENT_SECRET')!,
      redirect_uri:  FUNCTION_URL,
      grant_type:    'authorization_code',
      scope:         'Calendars.ReadWrite offline_access',
    }),
  })
  if (!res.ok) throw new Error(`Outlook token exchange failed: ${await res.text()}`)
  return res.json()
}

async function getOutlookPrimaryCalendar(accessToken: string): Promise<string> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/calendar', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return 'primary'
  const data = await res.json()
  return data.id ?? 'primary'
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token:  string
  refresh_token?: string
  expires_in?:   number
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } })
}
