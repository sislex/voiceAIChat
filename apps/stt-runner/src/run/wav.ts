// Кодирование PCM Int16 mono в WAV-буфер (Шаг 7).
// Пишем корректный 44-байтный заголовок @16 kHz, чтобы nodejs-whisper принял файл
// без конвертации через ffmpeg (валидатор проверяет 'RIFF' + sampleRate === 16000).

/**
 * Собирает WAV (PCM 16-bit, mono) из Int16-сэмплов.
 * @param pcm сэмплы Int16 mono
 * @param sampleRate частота дискретизации (для whisper — 16000)
 */
export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length * bytesPerSample

  const buffer = Buffer.alloc(44 + dataSize)

  // RIFF header
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')

  // fmt subchunk
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16) // размер fmt-чанка
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)

  // data subchunk
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], 44 + i * bytesPerSample)
  }

  return buffer
}
