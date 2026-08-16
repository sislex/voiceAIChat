# @voicechat/projects-app — frontend-модуль Projects

Пакет владеет публичными контрактами, маршрутизацией, React-независимым store и проектными UI-сценариями.

- Не импортировать внутренности `@voicechat/ui`, host stores или приложения.
- Не использовать `window.*`, `fetch`, `WebSocket` и Electron API; транспорт приходит через `ProjectsClient`.
- Общий Chat подключается только через `ProjectsChatPort`, оболочка — через `ProjectsHost`.
- Общие примитивы брать из `@voicechat/ui-kit`, доменные типы и чистую логику — из `@voicechat/shared`.
- Относительные импорты TypeScript пишутся без расширения, как в остальных frontend-пакетах.
- Гейт: `npm run -w @voicechat/projects-app typecheck && npm run -w @voicechat/projects-app test`.
