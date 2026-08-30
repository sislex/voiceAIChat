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
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-expanded={expanded || undefined}
    >
      <path d="M16 3 L21 3 L21 8" />
      <path d="M8 21 L3 21 L3 16" />
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

/**
 * Иконки действий карточки задачи. Раньше здесь стояли эмодзи (🗑 ✏️ 💬 ⚑): их
 * рисует шрифт системы, поэтому размер и вес прыгали от платформы к платформе, а
 * корзина на части машин выпадала в пустой прямоугольник. Цвет — `currentColor`,
 * чтобы кнопка сама решала, как иконка выглядит в теме и в hover.
 */
export function TrashIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 4V2.6h4V4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3.8 4l.6 8.4a1 1 0 0 0 1 .9h5.2a1 1 0 0 0 1-.9L12.2 4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.6 6.6v4.2M9.4 6.6v4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function PencilIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.2 2.4 13.6 4.8 5.6 12.8 2.4 13.6l.8-3.2 8-8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.8 3.8l2.4 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function ChatIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.5 9.4a1.4 1.4 0 0 1-1.4 1.4H5.6L2.5 13.4V4a1.4 1.4 0 0 1 1.4-1.4h8.2A1.4 1.4 0 0 1 13.5 4v5.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

export function FlagIcon({ filled = false }: { filled?: boolean } = {}): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 14V2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 3.2h7.4l-1.6 2.6 1.6 2.6H4V3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill={filled ? 'currentColor' : 'none'} />
    </svg>
  )
}
