// Subset of the Canopy schedule engine — only what the plan builder needs.

const OTHER = (p) => (p === 'parent_a' ? 'parent_b' : 'parent_a')

export const PATTERN_LABELS = {
  alternating_weeks: 'Alternating weeks (7–7)',
  '2_2_5_5':         '2‑2‑5‑5',
  '2_2_3':           '2‑2‑3',
  '3_4_4_3':         '3‑4‑4‑3',
  custom:            'Custom',
}

export function buildPresetPattern(patternType, startingParent) {
  const a = startingParent
  const b = OTHER(a)
  switch (patternType) {
    case 'alternating_weeks':
      return { cycle: [...Array(7).fill(a), ...Array(7).fill(b)] }
    case '2_2_5_5':
      return { cycle: [...Array(2).fill(a), ...Array(2).fill(b), ...Array(5).fill(a), ...Array(5).fill(b)] }
    case '2_2_3':
      return { cycle: [a,a,b,b,a,a,a, b,b,a,a,b,b,b] }
    case '3_4_4_3':
      return { cycle: [...Array(3).fill(a), ...Array(4).fill(b), ...Array(4).fill(a), ...Array(3).fill(b)] }
    default:
      return null
  }
}
