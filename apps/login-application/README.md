# @voicechat/login-application

Самостоятельное macOS ARM64 Electron-приложение для подключения текущего Mac.
Оно принимает `voicechat-login://enroll`, погашает краткоживущий enrollment и
запускает неизменённое ядро `apps/agent`. Альтернативно пользователь может войти
по адресу ChatAI, логину и паролю; пароль используется только для запроса входа и
не сохраняется. Machine token шифруется macOS Safe Storage.

Приложение намеренно находится вне корневых npm workspaces: Electron имеет
собственный lockfile и `node_modules`.

```bash
npm --prefix apps/login-application install
npm --prefix apps/login-application run typecheck
npm --prefix apps/login-application run test
npm --prefix apps/login-application run dist
npm --prefix apps/login-application run smoke
```

DMG создаётся как `release/voicechat-login-macos-arm64.dmg`. Сборка ad-hoc
подписывается существующим `afterPack`; notarization требует отдельных Apple
Developer credentials и в первый этап не входит.
