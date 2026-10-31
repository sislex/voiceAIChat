---
title: "Проверки по замене закреплённых архивов"
updated: 2026-10-29
checked: 4aa06d23
areas:
  - scripts/owner-pins.mjs
  - scripts/application-gate.mjs
  - scripts/release-gate.mjs
---

# Проверки по замене закреплённых архивов

Замена архива владельца в Core трогает `dependency-snapshots.json`,
`vendor/owner-artifacts.json`, `vendor/ui-libraries.json`, архивы `vendor/*.tgz`,
immutable vendor-release URLs (and legacy `file:vendor/...` references) в `package.json` корня и workspace, lockfile, записи
`deploy/tools.lock.json` и строки `image:` в compose. Раньше любой из этих файлов
считался неизвестной областью и запускал весь Core.

`scripts/owner-pins.mjs` доказывает, что дифф — только замена архивов, и называет
заменённые пакеты. Пакет считается изменённым по строке манифеста целиком (хэш архива,
коммит, происхождение), а не по версии: владелец может выпустить ту же версию с другим
содержимым, как контракты Web Reader 1.3.0. Не доказано и уходит в полный gate:
- unproven package fields or dependencies not pointing to a recognized vendor archive;
  root npm-script-only changes are proven separately and select tooling tests;
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

## Release base and independent checks

`gate:release` runs `scripts/release-gate.mjs`. The release center supplies
`VOICECHAT_RELEASE_BASE_SHA`, or the caller passes `--base`: a full 40-character
production commit available in the checkout. If it is absent or invalid, the
script runs all three gates: `gate:all`, `gate:performance`, `gate:system`.

With a valid production commit, the script first fetches
`refs/tags/verified/full-gate/*` from origin. A replacement base must be an
annotated tag pointing to the SHA in its name, contain `gate:all exit 0`, be an
ancestor of HEAD and descend from the production/candidate merge base.
Invalid tags are ignored; fetch failure keeps the production base instead of
trusting stale local attestations.

The application plan runs relative to this base. Proven pin-only changes use
the narrowed plan, excluding frontend E2E files already covered by owner checks.
A full plan or a non-pin-only plan runs `gate:all`. Performance and owner-system
checks are selected independently even when the application plan is full:

- Performance runs for a Core UI pin change or rendering, measurement or route
  budget paths listed in `PERFORMANCE_PATH_PREFIXES`.
- System checks select Core UI, Web Reader and/or Playwright Reader when their
  pin identity or corresponding public bridge/contract paths change
  (`SYSTEM_PATH_PREFIXES`); unrelated Core changes do not automatically select
  all owners.
- The log reports full/narrowed mode, the chosen base and planner reasons,
  plus an explicit performance skip when applicable.
