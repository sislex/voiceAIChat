# stand-fixes-v2 — хвосты доставки со стенда, Storybook стенда и сеть координатора

Ран `stand-fixes-v2`. Ветка задач — `dev`. Продолжение [make-stand-delivery-v1](make-stand-delivery-v1.md),
[make-stand-stories-v1](make-stand-stories-v1.md) и ночной проверки инспектора 2026-10-12.
Задачи выполняют воркеры MacBook (M2); M1 выключен.

## Что замечено на проде (Core 0.1.454, Make 1.7.0)

1. **Непонятная ошибка доставки.** «Отправить в dev», когда ветка стенда совпадает с `dev`: координатор отвечает
   400 `branch_patch_empty_or_large`, Core превращает любой отказ в `stand_delivery_request_failed`
   (`apps/server/src/makeBridge/standDeliveryCoordinator.ts`, `request()`; тело ответа намеренно не читается),
   Make показывает код как есть.
2. **Storybook стенда теряется при каждом деплое Core.** `StorybookSessions`
   (`apps/server/src/components/storybookSessions.ts`) держит сессии в памяти; после перезапуска `refresh()`
   отвечает `stopped`, хотя процесс Storybook на агенте мог выжить; владелец снова жмёт «Start Storybook».
3. **Стори с кириллическим названием не находится.** Id Storybook кириллицу сохраняет
   (`редизайн-кабинета--overview`, `storybookSanitize` в `packages/shared/src/projectComponents.ts`), но поиск в
   Make (`MakeProjectComponents.tsx`) сравнивает только `title` и `path` компонента — ни id, ни имя стори.
4. **Правила сети координатора не переживают перезагрузку.** Координатор слушает `0.0.0.0:8798`; порт закрыт
   правилами iptables (принять `lo` и `10.77.0.0/30`, остальное отбросить), добавленными вручную. На хосте
   (Ubuntu 24.04) нет `netfilter-persistent`, `nftables.service` выключен; переход `-j ts-input` (Tailscale) стоит
   перед правилом DROP.

## Решения

- **Коды отказа координатора проходят до пользователя по списку.** Core читает из тела ответа только поле
  `error`; если код в списке разрешённых — отвечает им же (статус координатора 400/403/409/503), иначе — прежний
  `stand_delivery_request_failed`. Остальное тело по-прежнему не читается и не логируется. Список — в
  `packages/shared` (`STAND_DELIVERY_ERROR_CODES`), Make показывает понятный текст RU/EN на каждый код.
- **Коды:** `branch_patch_empty_or_large` («Нет изменений относительно dev или правка слишком большая»),
  `branch_requires_secret_review` («Правка похожа на секрет — нужна проверка оператора»),
  `branch_project_scope_required`, `operator_scope_denied` («Нет доступа к доставке для этого проекта»),
  `branch_resubmit_required`, `branch_head_changed` («Ветка изменилась — отправьте ещё раз»),
  `stand_delivery_paused` («Доставка приостановлена оператором»), `stand_delivery_id_conflict`,
  `branch_task_id_collision` («Такая доставка уже есть»), `branch_source_not_configured` («Доставка не настроена
  на координаторе»).
- **Намерение сессии Storybook сохраняется в базе Core.** При старте записывается `{agentId, workspaceId, path,
  command, port}`, при явной остановке — удаляется. После перезапуска Core `refresh()` (когда агент онлайн) сначала
  пробует подхватить записанный порт (`storybookAnswers`), иначе запускает Storybook заново тем же путём, что
  `start()`. Явно остановленная сессия не воскресает.
- **Поиск в Make ищет и по стори.** Совпадение по `title`/`path` компонента, по имени и id каждой стори и по
  `storybookSanitize(запрос)` — введённое название находит id; точное совпадение id выбирает эту стори.
- **Правила сети — отдельный oneshot-юнит.** `scripts/control-firewall.sh` идемпотентно ставит три правила в начало
  цепочки INPUT (перед `ts-input`): ACCEPT `lo`, ACCEPT из `CONTROL_FIREWALL_ALLOW` (по умолчанию `10.77.0.0/30`),
  DROP остального на `PORT`. `install-host.sh` пишет `delivery-control-firewall.service` (`Before=delivery-control.service`).

## Задачи интегратора (Claude, вне манифеста)

- Копии плана в `docs/plans/` delivery-control и make до старта.
- После приёмки: выкат координатора, установка юнита на хосте координатора и проверка `iptables -S INPUT` после
  `systemctl restart delivery-control-firewall`; выпуск Make и Core; проверка на «Проекте 35»: «Отправить в dev» без
  изменений → понятный текст; деплой Core → Storybook стенда снова открыт без кнопки; поиск
  «редизайн» находит стори.

| B01 | delivery-control | — | Persistent firewall for the coordinator port, per docs/plans/stand-fixes-v2.md «Решения» (copy of the plan is in this repository): add `scripts/control-firewall.sh` (root, reads `PORT` default 8798 and `CONTROL_FIREWALL_ALLOW` default `10.77.0.0/30` from the environment/service.env): idempotently ensure, at the top of INPUT and in this order, ACCEPT tcp dport PORT on `lo`, ACCEPT tcp dport PORT from each allowed CIDR, DROP tcp dport PORT; use `iptables -C` before inserting so a second run adds nothing; `--dry-run` prints the commands. In `scripts/install-host.sh` write `/etc/systemd/system/delivery-control-firewall.service` (Type=oneshot, RemainAfterExit=yes, After=network-pre.target tailscaled.service, Before=delivery-control.service, WantedBy=multi-user.target, ExecStart running the script from `/opt/delivery-control/current/scripts`), add Wants/After for it to `delivery-control.service`, enable and start it before restarting the main service. Tests: `test/control_firewall_unit.py` with a fake `iptables` on PATH (state file answers `-C`): order, idempotence, custom CIDRs, dry-run; plus a check that install-host emits the unit; node wrapper `test/control-firewall.test.ts` like `test/host-retention.test.ts`. Document in docs/control-service-release.md. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Core | — | Pass allow-listed coordinator refusal codes through stand deliveries, per docs/plans/stand-fixes-v2.md «Решения»: in `apps/server/src/makeBridge/standDeliveryCoordinator.ts` `request()` read at most 4 KiB of a non-ok body, parse only its `error` string; when it is in `STAND_DELIVERY_ERROR_CODES` (new export in `packages/shared/src/standDelivery.ts`, the ten codes listed in the plan) throw `projectModeError(<coordinator status 400/403/409/503>, code)`, otherwise keep `stand_delivery_request_failed` with the current status; never log or return any other part of the body. Routes in `apps/server/src/routes/standDeliveries.ts` keep their shape. Tests: `makeBridge/standDeliveryCoordinator.test.ts` (400 `branch_patch_empty_or_large` passes through, an unknown code and a body with extra fields stay generic, oversized body is not read past the cap) and `routes/standDeliveries.test.ts` with the fake coordinator. Update docs/kb/server-internals.md. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Core | — | Restore stand Storybook sessions after a Core restart, per docs/plans/stand-fixes-v2.md «Решения»: in `apps/server/src/components/storybookSessions.ts` persist the session intent `{agentId, workspaceId, path, command, port}` when `start()` succeeds (app config `storybook.sessions` through the existing settings store, or a small table) and delete it on explicit `stop()`; on construction load intents and, in `refresh()` when the agent is online and no live session exists, first adopt the recorded port if `storybookAnswers` confirms it, otherwise start it again through the same path as `start()`; at most one restore attempt per intent per process start, failures leave the intent and report `stopped` with the error; an explicitly stopped session never comes back. Wire it in `server.ts` (remove the comment that sessions are lost on restart). Tests in `components/storybookSessions.test.ts` (restart with a surviving port adopts, restart without it re-starts, stop removes the intent) and `routes/projectComponents.stand.test.ts` (`/components/storybook/open` works after a simulated restart). Update docs/kb/deploy.md (managed stands). Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Make | — | Readable delivery refusals and story search, per docs/plans/stand-fixes-v2.md «Решения» (copy of the plan is in this repository): (1) in `packages/make-app/src/components/MakeProjectStand.tsx` map the ten coordinator codes from the plan to RU/EN texts in `packages/make-app/src/i18n/messages.ts` (keys next to the `standDelivery*` ones), unknown codes keep the current generic text; (2) in `packages/make-app/src/components/MakeProjectComponents.tsx` the search also matches each story's name and id and the sanitized query (same rule as Storybook: lowercase, punctuation and spaces to `-`, Unicode letters kept), so «Редизайн кабинета», «редизайн» and `редизайн-кабинета--overview` find the component; an exact id match selects that story; make sure story ids with non-ASCII letters are URL-encoded wherever Make builds a Storybook URL. Tests: `MakeProjectStand.dom.test.tsx` (a 400 `branch_patch_empty_or_large` shows the RU text), `MakeProjectComponents.dom.test.tsx` with a Cyrillic story fixture, `i18n/coverage.test.ts` stays green. Update docs/kb/project-mode.md. Gate: `npm run gate:task -- --base <sha>`. |
