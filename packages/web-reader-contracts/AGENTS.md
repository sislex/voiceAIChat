# web-reader-contracts

Переносимые порты и HTTP-клиенты Reader. Здесь нет БД, браузерного движка,
импортов исходников приложений или побочного запуска сервиса. Контракты данных
REST/WS остаются в `@voicechat/shared`; Node-транспорт и серверные типы — здесь.

Изменение публичного контракта проверяет его потребителей через каталог
`packages/shared/src/applicationCatalog.ts`. Для внутренней проверки:
`npm run -w @voicechat/web-reader-contracts typecheck` и `npm run -w @voicechat/web-reader-contracts test`.
