---
title: "Проверки по замене закреплённых архивов"
updated: 2026-09-30
checked: 27f3c69c
areas:
  - scripts/owner-pins.mjs
  - scripts/application-gate.mjs
  - scripts/release-gate.mjs
  - apps/server/src/releases/releaseManager.ts
---

# Проверки по замене закреплённых архивов

Замена архива владельца в Core трогает `dependency-snapshots.json`,
`vendor/owner-artifacts.json`, `vendor/ui-libraries.json`, архивы `vendor/*.tgz`,
ссылки `file:vendor/...` в `package.json` корня и workspace, lockfile, записи
`deploy/tools.lock.json` и строки `image:` в compose. Раньше любой из этих файлов
считался неизвестной областью и запускал весь Core.

`scripts/owner-pins.mjs` доказывает, что дифф — только замена архивов, и называет
заменённые пакеты. Пакет считается изменённым по строке манифеста целиком (хэш архива,
коммит, происхождение), а не по версии: владелец может выпустить ту же версию с другим
содержимым, как контракты Web Reader 1.3.0. Не доказано и уходит в полный gate:
- любое поле `package.json` кроме зависимостей или зависимость не на архив `vendor`;
- поле манифеста вне `packages`, запись `tools.lock.json` кроме `version`/`commit`;
- строка compose кроме `image:` или изменённое число строк;
- архив, которого нет ни в одном манифесте владельцев.

`planApplicationChecks` для доказанной замены:
- сверка закреплений: `shared-chat-artifacts`, `s3-provider-artifacts`,
  `model-speed-artifacts`, `application-frontend` (байты, происхождение, lock,
  встроенный renderer Desktop);
- потребители из lockfile: приложения, чьё дерево зависимостей содержит пакет. Core
  встраивает исходники Make и Web Reader, поэтому их замена выбирает typecheck, тесты
  и сборку сервера (в том числе контрактные тесты мостов). Изменение корневой записи
  lockfile принимается, только если оно сводится к заменённым пакетам;
- `build:frontends` и `verify:core-ui`, браузерные наборы приложения, для панелей
  владельцев — `toolIntegration`, для core-ui и Desktop — бюджеты маршрутов.

`gate:release` — `scripts/release-gate.mjs`. Центр релизов передаёт стадиям Regression
`VOICECHAT_RELEASE_BASE_SHA` — коммит последнего успешного выката в production. Если
дифф от него до кандидата состоит только из доказанной замены архивов и документации,
выполняется суженный план, а `gate:system` — только когда заменён архив core-ui,
Web Reader или Playwright Reader. Любое изменение самого Core, общей конфигурации,
неизвестный файл, недоказанная замена или отсутствие коммита production запускают
прежнюю цепочку `gate:all`, `gate:performance`, `gate:system` (`gate:release:full`).
