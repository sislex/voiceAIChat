// Декодирование base64-WAV (сервер шлёт TTS-аудио как base64 в JSON tts.audio)
// в ArrayBuffer для воспроизведения через ttsPlayer.

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
