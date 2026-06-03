export const NOTICE_TAGS = [
  { id: 'school',       label: 'School',       chip: 'bg-blue-100 text-blue-700',   active: 'bg-blue-600 text-white' },
  { id: 'health',       label: 'Health',       chip: 'bg-red-100 text-red-700',     active: 'bg-red-600 text-white' },
  { id: 'appointments', label: 'Appointments', chip: 'bg-violet-100 text-violet-700', active: 'bg-violet-600 text-white' },
  { id: 'clubs',        label: 'Clubs',        chip: 'bg-green-100 text-green-700', active: 'bg-green-600 text-white' },
  { id: 'holidays',     label: 'Holidays',     chip: 'bg-orange-100 text-orange-700', active: 'bg-orange-500 text-white' },
  { id: 'finance',      label: 'Finance',      chip: 'bg-yellow-100 text-yellow-800', active: 'bg-yellow-500 text-white' },
  { id: 'logistics',    label: 'Logistics',    chip: 'bg-cyan-100 text-cyan-700',   active: 'bg-cyan-600 text-white' },
  { id: 'wellbeing',    label: 'Wellbeing',    chip: 'bg-pink-100 text-pink-700',   active: 'bg-pink-600 text-white' },
  { id: 'achievements', label: 'Achievements', chip: 'bg-amber-100 text-amber-700', active: 'bg-amber-500 text-white' },
  { id: 'urgent',       label: 'Urgent',       chip: 'bg-rose-100 text-rose-700',   active: 'bg-rose-600 text-white' },
]

export function tagById(id) {
  return NOTICE_TAGS.find((t) => t.id === id) ?? null
}
