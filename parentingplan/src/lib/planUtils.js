// Shared helpers for displaying plan data

export function getSectionText(data, section) {
  if (!data) return ''
  const clean = v => (v || '').toString().replace(/_/g, ' ')
  switch (section) {
    case 'residence': {
      const labels = {
        alternating_weeks: 'Alternating weeks',
        '2_2_5_5': '2-2-5-5 pattern',
        '2_2_3':   '2-2-3 pattern',
        '3_4_4_3': '3-4-4-3 pattern',
        custom:    'Custom schedule',
      }
      const pat = data.patternType ? (labels[data.patternType] || clean(data.patternType)) : ''
      const loc = data.handoverLocation ? `handover at ${clean(data.handoverLocation)}` : ''
      return [pat, loc].filter(Boolean).join(' · ')
    }
    case 'holidays': {
      const split  = data.holidaySplit === 'equal' ? 'Equal time with each parent' : clean(data.holidaySplit)
      const max    = data.maxDays   ? `Max ${data.maxDays} consecutive days`  : ''
      const notice = data.noticeWeeks ? `${data.noticeWeeks} weeks notice`    : ''
      return [split, max, notice].filter(Boolean).join(' · ')
    }
    case 'special': {
      const xmas = data.christmas ? `Christmas: ${clean(data.christmas)}` : ''
      const bday = data.birthdays ? `Birthdays: ${clean(data.birthdays)}` : ''
      return [xmas, bday, data.fixedOccasions].filter(Boolean).join(' · ')
    }
    case 'communication': {
      const parts = []
      if (data.childContact)  parts.push(data.childContact)
      if (data.screenTime)    parts.push(`Screen time: ${data.screenTime}`)
      if (data.parentChannel) parts.push(`Parent comms: ${clean(data.parentChannel)}`)
      return parts.join(' · ')
    }
    case 'childcare': {
      const parts = []
      if (data.firstRefusal)   parts.push(`First refusal: ${clean(data.firstRefusal)}`)
      if (data.extendedFamily) parts.push(data.extendedFamily)
      return parts.join(' · ')
    }
    case 'education':
      return [data.schoolInfo, data.educationDisputes].filter(Boolean).join(' · ')
    case 'medical':
      return [data.routineHealth, data.nonEmergency, data.medicalEmergency].filter(Boolean).join(' · ')
    case 'decisions': {
      const jd = (data.jointDecisions || []).join(', ')
      return [jd ? `Joint decisions: ${jd}` : '', data.dailyRules, data.newPartners].filter(Boolean).join(' · ')
    }
    case 'financial':
      return [data.dayCosts, data.bigCosts, data.financialChange].filter(Boolean).join(' · ')
    case 'disputes': {
      const d = { mediation: 'Mediation', arbitration: 'Arbitration', solicitor: 'Legal advice', collaborative: 'Collaborative law' }
      return data.disputeProcess ? `Process: ${d[data.disputeProcess] || clean(data.disputeProcess)}` : ''
    }
    case 'review': {
      const r = { annually: 'Annual review', biannually: 'Every 6 months', major_change: 'On major life changes' }
      return data.reviewFrequency ? r[data.reviewFrequency] || clean(data.reviewFrequency) : ''
    }
    default: return ''
  }
}
