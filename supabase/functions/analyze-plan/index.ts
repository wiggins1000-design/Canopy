import Anthropic from 'npm:@anthropic-ai/sdk'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const LOCALE_NAMES: Record<string, string> = {
  'en-gb': 'England & Wales',
  'en-sc': 'Scotland',
  'en-ie': 'Ireland',
  'en-us': 'United States',
  'en-au': 'Australia',
  'en-ca': 'Canada',
  'other':  'International',
}

function f(v: string | undefined | null): string {
  return (!v || v.trim() === '') ? '[not completed]' : v
}

function buildSummary(data: Record<string, unknown>, p1: string, p2: string, locale: string): string {
  const children = ((data.children as any[]) ?? [])
    .filter(c => c.name).map(c => c.name).join(', ') || '[not completed]'

  const abroadInfo = ((data.abroadInfo as string[]) ?? []).join(', ') || '[not completed]'
  const jointDecisions = ((data.jointDecisions as string[]) ?? []).join(', ') || '[not completed]'
  const carers = ((data.carers as any[]) ?? [])
    .filter(c => c.name).map(c => `${c.name} (${c.relationship})`).join(', ') || '[not completed]'

  return `Parenting plan — ${p1} & ${p2}
Children: ${children}
Jurisdiction: ${LOCALE_NAMES[locale] ?? 'England & Wales'}

SCHEDULE: ${data.patternType ?? '[not completed]'}, starting with ${data.startingParent === 'parent_a' ? p1 : p2}

HANDOVERS:
- Location: ${data.handoverLocation ?? '[not completed]'}
- Late handover process: ${f(data.handoverLate as string)}

SCHOOL HOLIDAYS:
- Split: ${data.holidaySplit ?? '[not completed]'}
- Max consecutive days: ${data.maxDays ?? '[not completed]'}
- Notice required: ${data.noticeWeeks ? data.noticeWeeks + ' weeks' : '[not completed]'}

SPECIAL OCCASIONS:
- Christmas: ${data.christmas ?? '[not completed]'}
- Birthdays: ${data.birthdays ?? '[not completed]'}
- Other occasions: ${f(data.fixedOccasions as string)}

TRAVEL:
- International travel requirement: ${data.abroad ?? '[not completed]'}
- Notice period: ${data.abroadWeeks ? data.abroadWeeks + ' weeks' : '[not completed]'}
- Information to share: ${abroadInfo}
- Passports held by: ${data.passports ?? '[not completed]'}

DIGITAL LIFE:
- Screen time: ${f(data.screenTime as string)}
- Social media: ${f(data.socialMedia as string)}
- Restricted apps: ${f(data.restrictedApps as string)}
- Children's devices policy: ${f(data.devicesPolicy as string)}

COMMUNICATION:
- Child contacting other parent: ${f(data.childContact as string)}
- Contact restrictions: ${f(data.contactRestrictions as string)}
- Parent communication channel: ${data.parentChannel ?? '[not completed]'}
- Urgent contact process: ${f(data.urgentProcess as string)}
- Document sharing: ${f(data.documentSharing as string)}

CHILDCARE:
- First refusal: ${data.firstRefusal ?? '[not completed]'}
- Named carers: ${carers}
- Extended family: ${f(data.extendedFamily as string)}
- Siblings kept together: ${f(data.siblings as string)}

EDUCATION:
- Dispute resolution: ${f(data.educationDisputes as string)}
- School communication: ${f(data.schoolInfo as string)}

HEALTH:
- Routine appointments: ${f(data.routineHealth as string)}
- Non-emergency treatment: ${f(data.nonEmergency as string)}
- Medical emergency process: ${f(data.medicalEmergency as string)}

DECISIONS:
- Joint decisions required: ${jointDecisions}
- Daily rules: ${f(data.dailyRules as string)}
- New partners: ${f(data.newPartners as string)}

MONEY:
- Day-to-day costs: ${f(data.dayCosts as string)}
- Larger shared costs: ${f(data.bigCosts as string)}
- Financial change: ${f(data.financialChange as string)}

DISPUTES & REVIEW:
- Dispute process: ${data.disputeProcess ?? '[not completed]'}
- Review frequency: ${data.reviewFrequency ?? '[not completed]'}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { planData, locale, p1, p2 } = await req.json()

    const anthropic = new Anthropic()
    const summary = buildSummary(planData, p1 || 'Parent 1', p2 || 'Parent 2', locale || 'en-gb')
    const jurisdiction = LOCALE_NAMES[locale] ?? 'England & Wales'

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are reviewing a parenting plan for ${jurisdiction}. Return ONLY valid JSON, no other text or markdown.

Exact JSON format required:
{
  "completeness": <integer 0-100>,
  "gaps": [{ "section": "<section name>", "suggestion": "<specific 1-sentence action>" }],
  "strengths": ["<strength in 1 sentence>"],
  "priorities": ["<priority action in 1 sentence>"]
}

Rules:
- completeness: percentage of important sections that are filled in (not [not completed])
- gaps: up to 3 sections most likely to cause conflict if left vague — focus on [not completed] fields and areas where specificity matters most
- strengths: up to 3 things the plan does well
- priorities: up to 3 specific things to add next, most important first
- 1 short sentence per item, be specific and actionable
- Use ${jurisdiction} terminology

Plan:
${summary}`,
      }],
    })

    const raw = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '{}'
    const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
    const analysis = JSON.parse(cleaned)

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
