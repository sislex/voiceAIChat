// Лимит один на все переходы: модель → приложение → HTTP раннера → Chromium.
// Иначе интерфейс обещает файл, который следующий сервис не принимает.
export const BROWSER_UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024
export const BROWSER_COMMAND_BODY_LIMIT = 16 * 1024 * 1024
