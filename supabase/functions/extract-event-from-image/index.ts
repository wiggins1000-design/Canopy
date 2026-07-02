// Canopy — Supabase Edge Function: extract-event-from-image
//
// Accepts a base64-encoded image or a voice transcript and uses Claude to
// extract calendar event details. Returns structured event data to pre-fill
// the NewEventSheet form.
//
// ── Request body ──────────────────────────────────────────────────────────────
//   { type: 'image', image_base64: string, media_type: string }   — image capture
//   { type: 'voice', transcript: string }                         — voice note
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy extract-event-from-image --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Verify caller is authenticated
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: CORS })

  let body: any
  try { body = await req.json() } catch { return new Response('Invalid body', { status: 400, headers: CORS }) }

  const today = new Date().toISOString().split('T')[0]
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return new Response('AI not configured', { status: 500, headers: CORS })

  // Family member names, passed from the client so Claude can correct near-miss
  // transcriptions/OCR (e.g. voice input mishearing "Isabelle" as something similar-sounding)
  // to the actual spelling instead of whatever it guessed.
  const knownNames: string[] = Array.isArray(body?.known_names)
    ? body.known_names.filter((n: unknown) => typeof n === 'string' && n.trim()).slice(0, 20)
    : []
  const knownNamesLine = knownNames.length
    ? `\nKnown family member names: ${knownNames.join(', ')}. If the text/image contains a name that sounds or looks similar to one of these, use the correct spelling from this list rather than a phonetic guess.`
    : ''

  const SYSTEM_PROMPT = `You are a helpful assistant that extracts calendar event details from text or images.
Today's date is ${today}.
Return ONLY valid JSON — no markdown fences, no explanation:
{
  "title": "event title (required)",
  "date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD or null",
  "time": "HH:MM or null (24h format)",
  "notes": "any extra details, or null"
}
If you cannot determine a specific date, use today's date.
If you cannot determine a time, use null.
For voice notes like "football on Monday is now at 4:40" interpret relative days from today's date.${knownNamesLine}`

  let claudeMessages: any[]

  if (body.type === 'image') {
    const { image_base64, media_type } = body
    if (!image_base64) return new Response('Missing image_base64', { status: 400, headers: CORS })

    claudeMessages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type:       'base64',
            media_type: media_type ?? 'image/jpeg',
            data:       image_base64,
          },
        },
        {
          type: 'text',
          text: 'Extract the calendar event details from this image. It may be a screenshot, photo of a letter, WhatsApp message, school newsletter, or any other document.',
        },
      ],
    }]
  } else if (body.type === 'voice') {
    const { transcript } = body
    if (!transcript) return new Response('Missing transcript', { status: 400, headers: CORS })

    claudeMessages = [{
      role: 'user',
      content: `Extract the calendar event from this voice note: "${transcript}"`,
    }]
  } else if (body.type === 'receipt') {
    const { image_base64, media_type } = body
    if (!image_base64) return new Response('Missing image_base64', { status: 400, headers: CORS })

    // Override system prompt for receipt extraction
    const RECEIPT_PROMPT = `You are a helpful assistant that extracts expense details from receipt photos or images.
Today's date is ${today}.
Return ONLY valid JSON — no markdown fences, no explanation:
{
  "amount_pence": 1234,
  "date": "YYYY-MM-DD",
  "description": "merchant name or brief description",
  "category": "education|health|clothing|activities|travel|food|other"
}
amount_pence is the total amount in pence (integer, e.g. £12.34 = 1234). Use 0 if not found.
For date, use today if not visible. For category, infer from the merchant or items.`

    claudeMessages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type:       'base64',
            media_type: media_type ?? 'image/jpeg',
            data:       image_base64,
          },
        },
        { type: 'text', text: 'Extract the expense details from this receipt.' },
      ],
    }]

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 256,
          system:     RECEIPT_PROMPT,
          messages:   claudeMessages,
        }),
      })
      if (!res.ok) return new Response('AI extraction failed', { status: 500, headers: CORS })
      const data   = await res.json()
      const raw    = data.content?.[0]?.text ?? ''
      const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
      return new Response(JSON.stringify({ ok: true, receipt: parsed }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
  } else {
    return new Response('type must be image, voice or receipt', { status: 400, headers: CORS })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     SYSTEM_PROMPT,
        messages:   claudeMessages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Claude error:', err)
      return new Response('AI extraction failed', { status: 500, headers: CORS })
    }

    const data   = await res.json()
    const raw    = data.content?.[0]?.text ?? ''
    const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())

    return new Response(JSON.stringify({ ok: true, event: parsed }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('extract-event-from-image error:', e)
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
