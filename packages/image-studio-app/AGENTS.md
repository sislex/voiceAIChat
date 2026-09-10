# @voicechat/image-studio-app — Image Studio UI

Самостоятельная панель для общего web/desktop host. `frontend.tsx` регистрирует
настоящую поверхность, `panelContract.ts` задаёт её props, `panel.css` принадлежит
панели. Исходники, unit/DOM-тесты и сториз меняются в этом пакете.

- Гейт: `npm run gate:app -- image-studio-ui`; внутренние правки проверяют только приложение.
- Сборка: `npm run -w @voicechat/image-studio-app build`; watcher: та же команда с `dev`.
- Оболочка получает артефакт по manifest/SRI. Runtime-зависимости API передаются
  через props/порты; не импортируй `@voicechat/ui` и реализации других продуктов.
- React, UI-kit и общий реестр команд/маршрута предоставляет host API; общие
  редакторы и окна находятся в `ui-foundation`. Браузерный DOM допустим; HTTP/WS
  транспорта в продуктовой панели нет.
- Публичный контракт добавляет адресную проверку host. Релиз `image-studio-ui` использует
  `release.json`, `compatibility.mjs` и общие build/matrix/deploy инструменты.
- `e2e/applicationFrontend.e2e.test.ts` проверяет реальный артефакт, общий React,
  Desktop URL, версию и целостность без сборки shell.

Подробности: [UI KB](../../docs/kb/ui.md#независимые-артефакты-продуктовых-панелей),
[релизы](../../docs/kb/features/releases.md#независимые-выпуски-приложений).
