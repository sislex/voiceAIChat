// Аватар человека: цветной круг с инициалами.
//
// Жил в канбане (`kanbanMeta.tsx`) и был доступен только доске. Как только
// инициалы понадобились списку пользователей и карточке профиля, копия неизбежно
// разошлась бы с оригиналом — прежде всего подбором светлоты, который тут не
// украшение, а требование контраста.

/** Стабильный хеш строки: один и тот же логин всегда даёт один и тот же цвет. */
function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Инициалы для аватара (до двух букв логина). */
export function initials(username: string): string {
  const parts = username.split(/[._\-\s]+/).filter(Boolean)
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : username.slice(0, 2)
  return two.toUpperCase()
}

/** Относительная яркость канала sRGB по WCAG 2.1. */
function channel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** HSL → относительная яркость. Насыщенность и тон — в долях, светлота в %. */
function hslLuminance(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return 0.2126 * channel(r + m) + 0.7152 * channel(g + m) + 0.0722 * channel(b + m)
}

/** Контраст фона аватара с белой подписью на нём. */
export function avatarContrast(hue: number, lightness: number): number {
  return 1.05 / (hslLuminance(hue, AVATAR_SATURATION, lightness) + 0.05)
}

const AVATAR_SATURATION = 55

/**
 * Цвет аватара по логину. Светлота подбирается под тон, а не берётся общей:
 * при фиксированных 42% зелёные и жёлтые тона давали с белой подписью всего
 * 3.06:1 при норме AA 4.5:1 — axe ловил это на реальной доске.
 */
export function avatarColor(username: string): string {
  const hue = hash(username) % 360
  for (let lightness = 42; lightness > 12; lightness -= 1) {
    if (avatarContrast(hue, lightness) >= 4.5) return `hsl(${hue}, ${AVATAR_SATURATION}%, ${lightness}%)`
  }
  return `hsl(${hue}, ${AVATAR_SATURATION}%, 12%)`
}

export interface AvatarProps {
  username: string
  /** Сторона круга в пикселях; шрифт подбирается от неё. */
  size?: number
  /** Дополнительный класс потребителя — доска метит им свои кружки. */
  className?: string
  testId?: string
}

/** Аватар: цветной круг с инициалами. */
export function Avatar({ username, size = 24, className, testId }: AvatarProps): JSX.Element {
  return (
    <span
      className={['vc-avatar', className].filter(Boolean).join(' ')}
      title={username}
      style={{ width: size, height: size, background: avatarColor(username), fontSize: Math.round(size * 0.42) }}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {initials(username)}
    </span>
  )
}
