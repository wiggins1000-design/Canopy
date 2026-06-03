const styles = {
  pending:         'bg-yellow-100 text-yellow-800',
  accepted:        'bg-green-100 text-green-800',
  declined:        'bg-red-100 text-red-800',
  expired:         'bg-gray-100 text-gray-500',
  offered:         'bg-purple-100 text-purple-800',
  offer_accepted:  'bg-green-100 text-green-800',
  change_pending:  'bg-yellow-100 text-yellow-800',
  change_accepted: 'bg-blue-100 text-blue-800',
  parent_a:        'bg-pa-100 text-pa-700',
  parent_b:        'bg-pb-100 text-pb-700',
}

export default function Badge({ label, type = 'pending', className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[type] ?? 'bg-gray-100 text-gray-700'} ${className}`}>
      {label}
    </span>
  )
}
