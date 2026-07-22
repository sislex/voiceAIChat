// Template-иконка для menu bar (монохром + альфа; macOS перекрашивает сам).
// Встроена как base64 PNG, чтобы не зависеть от путей к ресурсам в бандле.

import { nativeImage, type NativeImage } from 'electron'

const PNG_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAL0lEQVR4nGNgoA74jwMiKcCujSYK/uNXgGoShgJ0i0g3gQg3MCAFGqneJBDUlAAAOrI0zJwXj3YAAAAASUVORK5CYII='
const PNG_32 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAQAAADZc7J/AAAAVElEQVR4nGNgGAUI8J9ESBsDSHHtqAEkGIBNlAQDSBDFJojbVUQZgDtUiDIAX6ASYQD+OKGHARR7Ab8R9IpGmChmGUBiUqbQAFyGDlIDBrZUHrkAAM5ezzGPJzjRAAAAAElFTkSuQmCC'

export function trayIcon(): NativeImage {
  const img = nativeImage.createFromBuffer(Buffer.from(PNG_16, 'base64'))
  img.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(PNG_32, 'base64') })
  img.setTemplateImage(true)
  return img
}
