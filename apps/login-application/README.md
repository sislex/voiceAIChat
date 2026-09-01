# VoiceChat Login

Самостоятельное macOS ARM64 Electron-приложение для подключения текущего Mac.
Оно принимает `voicechat-login://enroll`, погашает короткоживущий enrollment и
запускает переиспользуемое ядро `apps/agent`. Пароль используется только для
получения web-сессии и не сохраняется.

Проверка:

```bash
npm install --prefix apps/login-application
npm --prefix apps/login-application run typecheck
npm --prefix apps/login-application run test
npm --prefix apps/login-application run dist
npm --prefix apps/login-application run smoke
```
