// Logs Claude API usage/cost to claude_usage_log for the /admin cost
// breakdown. Call after every Claude fetch, passing the parsed response
// body's `usage` field. Never throws — a logging failure must not break
// the actual feature.
//
// Pricing table — Haiku 4.5 is the only model any edge function calls as
// of 2026-07-07. Update here if pricing changes or a new model is added;
// existing rows keep their already-computed cost_usd (not retroactive).
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
}

export type ClaudeUsageCategory =
  | 'term_dates' | 'familyfeed' | 'plan_review'
  | 'event_extraction' | 'admin_tools' | 'other'

export async function logClaudeUsage(
  supabase: { from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> } },
  opts: {
    category: ClaudeUsageCategory
    edgeFunction: string
    model: string
    usage: { input_tokens?: number; output_tokens?: number } | undefined
    familyId?: string | null
  },
): Promise<void> {
  try {
    const inputTokens  = opts.usage?.input_tokens  ?? 0
    const outputTokens = opts.usage?.output_tokens ?? 0
    const price = PRICING_PER_MTOK[opts.model]
    const costUsd = price
      ? (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output
      : 0

    await supabase.from('claude_usage_log').insert({
      category:       opts.category,
      edge_function:  opts.edgeFunction,
      family_id:      opts.familyId ?? null,
      model:          opts.model,
      input_tokens:   inputTokens,
      output_tokens:  outputTokens,
      cost_usd:       costUsd,
    })
  } catch (e) {
    console.error('logClaudeUsage failed (non-fatal):', e)
  }
}
