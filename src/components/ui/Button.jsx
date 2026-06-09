const variants = {
  primary:   'bg-canopy-mid text-white hover:bg-canopy-deep active:bg-canopy-deep',
  secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 active:bg-gray-300',
  danger:    'bg-red-600 text-white hover:bg-red-700',
  ghost:     'text-gray-600 hover:bg-gray-100',
  pa:        'bg-pa-600 text-white hover:bg-pa-700',
  pb:        'bg-pb-600 text-white hover:bg-pb-700',
}

export default function Button({ children, variant = 'primary', className = '', disabled, loading, ...props }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-canopy-green',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className,
      ].join(' ')}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      )}
      {children}
    </button>
  )
}
