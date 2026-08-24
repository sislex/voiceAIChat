// Инлайн-SVG иконки из прототипа.

export function GearIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.4" stroke="#55534A" strokeWidth="1.5" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"
        stroke="#55534A"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Воронка — фильтр списка (в сайдбаре над списком бесед). */
export function FilterIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 3.5h12l-4.6 5.3v4.2l-2.8 1.4V8.8L2 3.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MicIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="7" y="2.5" width="6" height="10" rx="3" fill="currentColor" />
      <path
        d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SendIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 10.5 16.5 4 12 17l-3-5-6-1.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export function StopIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <rect x="3" y="3" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  )
}

export function DiagonalResizeIcon({ expanded = false }: { expanded?: boolean } = {}): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {expanded ? (
        <>
          <path d="M6.5 6.5 3 3M3 3h3M3 3v3M9.5 9.5 13 13M13 13h-3M13 13v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M2.5 2.5 6 6M6 6V3M6 6H3M13.5 13.5 10 10M10 10v3M10 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}

export function WandIcon(): JSX.Element {
  // Волшебная палочка со «звёздами» — помощник промптов.
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M11 3 4 10l-1.5 4.5L7 13l7-7-3-3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 4.5 12.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13.5 1.5v2M16 2.5h-2M14.5 12v1.6M16.3 12.8h-1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
