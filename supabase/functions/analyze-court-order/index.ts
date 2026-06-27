// Canopy — Supabase Edge Function: analyze-court-order
//
// Reads a court order PDF from Supabase Storage, extracts structured rules
// using Claude, and saves them to the court_orders table with status 'needs_approval'.
// Both parents must then approve before rules become active.
//
// ── Request body ──────────────────────────────────────────────────────────────
//   { order_id: string }   — court_orders.id to analyze
//
// ── Secrets required ─────────────────────────────────────────────────────────
//   ANTHROPIC_API_KEY
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   SUPABASE_ANON_KEY (auto-injected)
//
// ── Deploy ───────────────────────────────────────────────────────────────────
//   npx supabase functions deploy analyze-court-order --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

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

  const { data: memberRow } = await supabase
    .from('family_members')
    .select('family_id, role')
    .eq('user_id', user.id)
    .single()
  if (!memberRow || !['parent_a', 'parent_b'].includes(memberRow.role)) {
    return new Response('Only parents can analyze court orders', { status: 403, headers: CORS })
  }

  let body: any
  try { body = await req.json() } catch { return new Response('Invalid body', { status: 400, headers: CORS }) }

  const { order_id } = body
  if (!order_id) return new Response('Missing order_id', { status: 400, headers: CORS })

  // Load the court order record
  const { data: order } = await supabase
    .from('court_orders')
    .select('*')
    .eq('id', order_id)
    .eq('family_id', memberRow.family_id)
    .single()

  if (!order) return new Response('Court order not found', { status: 404, headers: CORS })
  if (!order.file_url) return new Response('No file attached', { status: 400, headers: CORS })

  // Mark as analyzing
  await supabase.from('court_orders').update({ status: 'analyzing', updated_at: new Date().toISOString() }).eq('id', order_id)

  try {
    // Generate a short-lived signed URL so Jina can access the private vault bucket
    const { data: signedData, error: signedErr } = await supabase.storage
      .from('vault')
      .createSignedUrl(order.file_url, 120)

    if (signedErr || !signedData?.signedUrl) {
      await supabase.from('court_orders').update({
        status: 'failed', error_msg: 'Could not generate a download link for the document.', updated_at: new Date().toISOString(),
      }).eq('id', order_id)
      return new Response(JSON.stringify({ ok: false, error: 'Signed URL failed' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const pdfText = await fetchViaJina(signedData.signedUrl)
    if (!pdfText) {
      await supabase.from('court_orders').update({
        status: 'failed', error_msg: 'Could not read the PDF. Ensure it is a text-based (not scanned) PDF.', updated_at: new Date().toISOString(),
      }).eq('id', order_id)
      return new Response(JSON.stringify({ ok: false, error: 'Could not read PDF' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Extract structured rules with Claude
    const rules = await extractCourtOrderRules(pdfText)
    if (!rules) {
      await supabase.from('court_orders').update({
        status: 'failed', error_msg: 'Could not extract arrangement details from the document. Please check it contains information about child arrangements.', updated_at: new Date().toISOString(),
      }).eq('id', order_id)
      return new Response(JSON.stringify({ ok: false, error: 'Extraction failed' }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (rules.error) {
      await supabase.from('court_orders').update({
        status: 'failed', error_msg: rules.error, updated_at: new Date().toISOString(),
      }).eq('id', order_id)
      return new Response(JSON.stringify({ ok: false, error: rules.error }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    await supabase.from('court_orders').update({
      raw_rules:   rules,
      status:      'needs_approval',
      approved_by: [],
      updated_at:  new Date().toISOString(),
    }).eq('id', order_id)

    return new Response(JSON.stringify({ ok: true, rules }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('analyze-court-order error:', e)
    await supabase.from('court_orders').update({
      status: 'failed', error_msg: e.message, updated_at: new Date().toISOString(),
    }).eq('id', order_id)
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

// ── Claude extraction ─────────────────────────────────────────────────────────

async function extractCourtOrderRules(pdfText: string): Promise<any | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return null

  const prompt = `You are analyzing a document relating to child arrangements after separation. This may be a court order, child arrangements order, parenting plan, mediation agreement, separation agreement, or any other document describing how separated parents share care of their children.

Extract the key provisions into structured rules that can be used to check whether proposed schedule changes or holiday requests comply with the agreed arrangement.

Return ONLY valid JSON — no markdown, no explanation:
{
  "summary": "1-2 sentence plain English summary of the core arrangement",
  "residence": {
    "primary_parent": "parent_a or parent_b or shared — who has primary residence",
    "description": "brief description of the residential arrangement"
  },
  "holiday_entitlements": [
    {
      "period": "e.g. Christmas, Easter, Summer, Half-term",
      "parent_a_days": number or null,
      "parent_b_days": number or null,
      "advance_notice_days": number or null,
      "notes": "any specific conditions"
    }
  ],
  "notice_requirements": {
    "schedule_change_hours": number or null,
    "holiday_request_days": number or null,
    "notes": "any specific conditions"
  },
  "geographic_restrictions": "e.g. must not be taken outside England and Wales without written consent, or null",
  "other_provisions": [
    "any other notable provisions as plain English strings"
  ],
  "confidence": "high / medium / low — how confident you are in the extraction"
}

If this does not appear to contain any information about child arrangements or parenting after separation, return:
{ "error": "Not a parenting arrangements document" }

Document:
${pdfText.slice(0, 10000)}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) { console.error('Claude error:', await res.text()); return null }
    const data = await res.json()
    const raw  = data.content?.[0]?.text ?? ''
    return JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
  } catch (e) {
    console.error('extractCourtOrderRules error:', e)
    return null
  }
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      signal:  AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const text = await res.text()
    return text.slice(0, 12000)
  } catch {
    return null
  }
}
