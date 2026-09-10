// Звуковые сигналы UX через Web Audio API (без ассетов, офлайн).
// Три коротких сигнала: старт записи, стоп записи, «модель думает».
// В окружении без AudioContext (jsdom в тестах) — безопасный no-op.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

/** Один тон с плавной атакой/затуханием (без щелчков). */
function tone(
  c: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  peak = 0.09
): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  const t0 = c.currentTime + startOffset
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.03)
}

/** Проигрывает последовательность тонов [частота, смещение(с), длительность(с)]. */
function play(sequence: Array<[number, number, number]>): void {
  const c = getCtx()
  if (!c) return
  // Контекст может быть suspended до жеста пользователя — возобновляем.
  void c.resume?.()
  for (const [freq, offset, dur] of sequence) tone(c, freq, offset, dur)
}

/** Начало записи: восходящие два тона. */
export function playStartCue(): void {
  play([
    [660, 0, 0.09],
    [990, 0.1, 0.13]
  ])
}

/** Остановка записи: нисходящие два тона. */
export function playStopCue(): void {
  play([
    [880, 0, 0.09],
    [587, 0.1, 0.13]
  ])
}

/** «Модель думает»: мягкий одиночный тон. */
export function playThinkingCue(): void {
  play([[523, 0, 0.16]])
}
