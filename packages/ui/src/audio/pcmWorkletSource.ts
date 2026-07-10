// Исходник AudioWorklet-процессора как строка. Превращается в blob:-URL и грузится
// через audioWorklet.addModule (см. browserAudio.ts). Держим строкой намеренно —
// чтобы не зависеть от эмита/инлайна ассетов сборщиком: работает одинаково в web
// (Vite) и в Electron (file://), где обычный ассет-URL/`new URL(import.meta.url)`
// в линкованном пакете вёл себя ненадёжно.
//
// Код исполняется в AudioWorkletGlobalScope (отдельный поток): только пересылает
// сырые mono-фреймы Float32 в основной поток, где идёт ресемпл/конвертация/чанкинг
// (см. pcm.ts).
export const PCM_WORKLET_SOURCE = `
class PcmForwardProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]
    if (channel && channel.length > 0) {
      // Буфер переиспользуется движком — копируем перед отправкой.
      this.port.postMessage(channel.slice(0))
    }
    // true — держим процессор живым, пока узел подключён.
    return true
  }
}
registerProcessor('pcm-forward', PcmForwardProcessor)
`
