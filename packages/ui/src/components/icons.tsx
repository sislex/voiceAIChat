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

export function MicIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="7" y="2.5" width="6" height="10" rx="3" fill="#fff" />
      <path
        d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"
        stroke="#fff"
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
        stroke="#fff"
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
      <rect x="3" y="3" width="10" height="10" rx="2.5" fill="#D5482F" />
    </svg>
  )
}
