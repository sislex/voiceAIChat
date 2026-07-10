// Очередь воспроизведения синтезированной речи (Web Audio). Клипы (WAV-байты)
// приходят по одному на предложение и играются последовательно. Без AudioContext
// (jsdom) — сразу вызывает onEnded (клип «проигран»), чтобы логика стора шла дальше.

interface Clip {
  audio: ArrayBuffer
  onEnded: () => void
}

/** Пауза между предложениями при воспроизведении (мс). */
const GAP_MS = 500

let ctx: AudioContext | null = null
let queue: Clip[] = []
let playing = false
let currentSource: AudioBufferSourceNode | null = null
let gapTimer: ReturnType<typeof setTimeout> | null = null

function getCtx(): AudioContext | null {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

/** Добавить клип в очередь воспроизведения; onEnded — после завершения ИМЕННО его. */
export function enqueueTtsAudio(audio: ArrayBuffer, onEnded: () => void): void {
  queue.push({ audio, onEnded })
  if (!playing && !gapTimer) void pump()
}

/** Пауза перед следующим предложением, затем воспроизведение. */
function scheduleNext(): void {
  if (gapTimer) return
  gapTimer = setTimeout(() => {
    gapTimer = null
    void pump()
  }, GAP_MS)
}

async function pump(): Promise<void> {
  if (playing) return
  const clip = queue.shift()
  if (!clip) return
  playing = true

  const c = getCtx()
  if (!c) {
    // Без Web Audio (тесты) — без паузы, чтобы не тормозить.
    playing = false
    clip.onEnded()
    void pump()
    return
  }
  void c.resume?.()
  try {
    const buffer = await c.decodeAudioData(clip.audio.slice(0))
    const src = c.createBufferSource()
    src.buffer = buffer
    src.connect(c.destination)
    src.onended = () => {
      if (currentSource === src) currentSource = null
      playing = false
      clip.onEnded()
      scheduleNext() // пауза 0.5с между предложениями
    }
    currentSource = src
    src.start()
  } catch (err) {
    console.warn('[tts] воспроизведение не удалось', err)
    playing = false
    clip.onEnded()
    void pump()
  }
}

/** Останавливает воспроизведение и очищает очередь (barge-in / «стоп» / замена). */
export function stopTts(): void {
  queue = []
  if (gapTimer) {
    clearTimeout(gapTimer)
    gapTimer = null
  }
  if (currentSource) {
    try {
      currentSource.onended = null
      currentSource.stop()
    } catch {
      /* уже остановлен */
    }
    currentSource = null
  }
  playing = false
}
