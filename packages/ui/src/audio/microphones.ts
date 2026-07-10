// Перечисление доступных микрофонов (Шаг 6).

export interface MicDevice {
  deviceId: string
  label: string
}

/**
 * Список аудио-входов через enumerateDevices. Метки доступны только после выдачи
 * разрешения на микрофон — до этого подставляем «Микрофон N». В окружении без
 * mediaDevices (напр. jsdom в тестах) возвращает пустой список.
 */
export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Микрофон ${i + 1}` }))
}
