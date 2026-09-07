// Minimal stroke icons (24x24, inherit currentColor). Kept inline so the app has
// zero icon-library dependencies.

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const ChevronDown = (p) => (
  <svg {...base} {...p}><path d="m6 9 6 6 6-6" /></svg>
)
export const ChevronLeft = (p) => (
  <svg {...base} {...p}><path d="m15 18-6-6 6-6" /></svg>
)
export const ChevronRight = (p) => (
  <svg {...base} {...p}><path d="m9 18 6-6-6-6" /></svg>
)
export const Check = (p) => (
  <svg {...base} {...p}><path d="M20 6 9 17l-5-5" /></svg>
)
export const LogOut = (p) => (
  <svg {...base} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
  </svg>
)
export const Clock = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
export const AppsGrid = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)
export const Calendar = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" />
  </svg>
)
export const Activity = (p) => (
  <svg {...base} {...p}><path d="M22 12h-4l-3 8-6-16-3 8H2" /></svg>
)
export const Globe = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
  </svg>
)
export const LayoutGrid = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)
export const Monitor = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="3" width="20" height="14" rx="2.5" /><path d="M8 21h8M12 17v4" />
  </svg>
)
export const ShieldCheck = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9.5 12 2 2 3.5-4" />
  </svg>
)
export const Spinner = (p) => (
  <svg {...base} {...p} className={`anim-spin ${p?.className || ''}`}>
    <path d="M21 12a9 9 0 1 1-6.2-8.5" />
  </svg>
)
export const Lock = (p) => (
  <svg {...base} {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
)
export const Sun = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
  </svg>
)
export const Moon = (p) => (
  <svg {...base} {...p}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" /></svg>
)
export const Plus = (p) => (
  <svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
)
export const Trash = (p) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
)
export const Maximize = (p) => (
  <svg {...base} {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
  </svg>
)
export const Ban = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" /><path d="m5.5 5.5 13 13" />
  </svg>
)
export const Minimize = (p) => (
  <svg {...base} {...p}>
    <path d="M9 3v3a2 2 0 0 1-2 2H4M21 9h-3a2 2 0 0 1-2-2V4M3 15h3a2 2 0 0 1 2 2v3M15 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
)
