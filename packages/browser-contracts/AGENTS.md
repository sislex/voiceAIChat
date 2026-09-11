# browser-contracts

Переносимые порты и HTTP-клиенты Reader. Здесь нет БД, браузерного движка,
импортов исходников приложений или побочного запуска сервиса. Контракты данных
REST/WS остаются в `@voicechat/shared`; Node-транспорт и серверные типы — здесь.

Изменение публичного контракта проверяет его потребителей через каталог
`packages/shared/src/applicationCatalog.ts`. Для внутренней проверки:
`npm run -w @voicechat/browser-contracts typecheck` и `npm run -w @voicechat/browser-contracts test`.

The `./audit` export contains pure generators for trusted DOM audits and control probes.
Both proxy Reader and native browser-runner execute the same checks; this package
does not execute DOM code or start a browser. Keep new audit groups here to avoid
different findings between engines. Add examples to the shared registry exposed
only by `./audit/fixtures`; both browser suites iterate it. Production imports must
not load the fixture entry point. Audit source changes automatically select Reader E2E.
Control probes share the native DOM prelude and have a separate bounded result
contract. Keep physical hit testing distinct from semantic reading visibility and
from an attempted application interaction.

Form audit fixtures can request real keyboard editing before observation. Keep
that preparation in the test-only fixture entry point; auditing must not read live
values, call validation methods or dispatch invalid events. Native validity states
are informational and are not automatically application defects.
