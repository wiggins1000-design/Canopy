import { useState } from 'react'
import BottomSheet from '../ui/BottomSheet'
import Button from '../ui/Button'

export const THREAD_PRESETS = [
  { id: 'education',   label: 'Education',         emoji: '📚' },
  { id: 'health',      label: 'Health & Medical',  emoji: '🏥' },
  { id: 'finance',     label: 'Finance',           emoji: '💰' },
  { id: 'logistics',   label: 'Logistics',         emoji: '🚗' },
  { id: 'appointments',label: 'Appointments',      emoji: '📅' },
  { id: 'wellbeing',   label: 'Wellbeing',         emoji: '💚' },
  { id: 'holidays',    label: 'Holidays & Travel', emoji: '✈️' },
  { id: 'clubs',       label: 'Clubs & Activities',emoji: '⚽' },
  { id: 'general',     label: 'General',           emoji: '💬' },
]

export default function NewThreadSheet({ open, onClose, existingPresets = [], onCreate }) {
  const [selected, setSelected] = useState(null)
  const [custom, setCustom]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  async function handleCreate() {
    const topic = selected
      ? THREAD_PRESETS.find((p) => p.id === selected)?.label
      : custom.trim()

    if (!topic) { setError('Choose a topic or enter a custom one.'); return }
    setSaving(true)
    setError(null)
    const { error: err } = await onCreate(topic, selected ?? null)
    if (err) { setError(err.message); setSaving(false); return }
    setSelected(null)
    setCustom('')
    setSaving(false)
    onClose()
  }

  function handleClose() {
    setSelected(null)
    setCustom('')
    setError(null)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="New conversation">
      <div className="px-5 py-4 space-y-5">

        {/* Prompt */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-sm text-gray-600 leading-relaxed">
            Keeping different topics in separate conversations helps you both stay focused and makes your records clearer — especially if they're ever needed legally.
          </p>
        </div>

        {/* Preset topics */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Choose a topic</p>
          <div className="grid grid-cols-3 gap-2">
            {THREAD_PRESETS.map((p) => {
              const taken = existingPresets.includes(p.id)
              const active = selected === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={taken}
                  onClick={() => { setSelected(active ? null : p.id); setCustom('') }}
                  className={[
                    'flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-semibold transition-colors border',
                    taken  ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed' :
                    active ? 'bg-canopy-deep text-white border-canopy-deep' :
                             'bg-white text-gray-700 border-gray-200 hover:border-canopy-mist hover:bg-canopy-frost',
                  ].join(' ')}
                >
                  <span className="text-xl">{p.emoji}</span>
                  <span className="text-center leading-tight">{p.label}</span>
                  {taken && <span className="text-[10px] font-normal">exists</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom topic */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Or enter a custom topic</p>
          <input
            type="text"
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setSelected(null) }}
            placeholder="e.g. Swimming lessons"
            maxLength={60}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-canopy-green"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button
          className="w-full py-3"
          loading={saving}
          disabled={!selected && !custom.trim()}
          onClick={handleCreate}
        >
          Start conversation
        </Button>
      </div>
    </BottomSheet>
  )
}
