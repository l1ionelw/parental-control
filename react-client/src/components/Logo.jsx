// Parental Controls brand mark: a soft gradient shield with a check. `size` controls the mark;
// pass `withWordmark` to show the name beside it.

export default function Logo({ size = 34, withWordmark = false }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
        <defs>
          <linearGradient id="havenGrad" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#7C3AED" />
            <stop offset="1" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
        <path
          d="M20 3.5 6.5 8.6v9.2c0 8.1 5.6 13.4 13.5 16.7 7.9-3.3 13.5-8.6 13.5-16.7V8.6L20 3.5Z"
          fill="url(#havenGrad)"
        />
        <path
          d="m13.8 20.2 4.1 4 8.3-9.4"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && (
        <span className="text-[1.25rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">Parental Controls</span>
      )}
    </div>
  )
}
