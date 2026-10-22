# make-project-quota-v1 — квота проекта Make 512 МБ и её изменение администратором

Ран `make-project-quota-v1`. Ветка задач — `dev`. Задачи выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

2026-10-17 у проекта Make закончилось место: квота проекта зашита константой `MAKE_LIMITS.maxProjectBytes = 256 МиБ`
(`packages/make-contracts/src/make.ts`), проверяется в `apps/make/src/workspace.ts` при записи файлов и показывается в
`packages/make-app/src/components/MakeUsageDialog.tsx`. Владелец поручил поднять квоту до 512 МБ и дать администраторам
возможность менять размер конкретного проекта в его настройках.

Целевое поведение:

- Квота по умолчанию — 512 МиБ на проект; квота на пользователя (`maxUserBytes`) не меняется.
- У проекта Make есть переопределение `quotaBytes` в его настройках (`.make/settings.json` рядом с `mode`, `stack`,
  `uiKit`); допустимый диапазон 64 МиБ … 4 ГиБ. Менять его может только пользователь с системной ролью `admin`
  (хост-аутентификация кладёт в `req.user` имя и роль); остальным — 403. Проверка квоты и отчёт об использовании
  (`GET /api/make/:id/usage`, поле `limitBytes`, метрика `voicechat_make_project_limit_bytes`) берут переопределение, если оно есть.
- В диалоге использования места у администратора появляется поле «Квота проекта» с пресетами 256 МБ, 512 МБ, 1 ГБ, 2 ГБ и
  произвольным значением; у остальных поле только читается.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки: выпуск Make 1.8.0, закрепление `@voicechat/make-contracts` и образа Make в Core, релиз Core и деплой;
  проверка на проде: квота проекта владельца показывает 512 МБ, администратор меняет её через API и диалог.

| B01 | Make | — | Project quota default and admin override (self-contained, repository `sislex/make`, branch `dev`): in `packages/make-contracts/src/make.ts` raise `MAKE_LIMITS.maxProjectBytes` to `512 * 1024 * 1024`, add `MAKE_QUOTA_RANGE = { minBytes: 64 MiB, maxBytes: 4 GiB }` and the optional field `quotaBytes?: number` to the project settings type that `apps/make/src/workspace.ts` persists in `.make/settings.json` next to `mode`, `stack` and `uiKit`; in `workspace.ts` read and write `quotaBytes` with the other settings, and make the quota check that today throws `MakeError('quota', …)` when `usage.totalBytes - prev + content.byteLength > MAKE_LIMITS.maxProjectBytes`, the usage report (`limitBytes`) and the per-user totals use `settings.quotaBytes ?? MAKE_LIMITS.maxProjectBytes` (the user quota `maxUserBytes` stays as is); in the settings update route of `apps/make/src/routes.ts` accept `quotaBytes` (integer within `MAKE_QUOTA_RANGE`, or `null` to drop the override) only when the request user has the system role `admin` — read it structurally from `req.user` the same way `uid` reads the name (`(req as { user?: { name: string; role?: string } }).user?.role`), otherwise answer 403 `quota_admin_only`; the settings read route returns `quotaBytes` and the effective `limitBytes`; in `packages/make-app/src/components/MakeUsageDialog.tsx` add a «Квота проекта» control (presets 256 МБ, 512 МБ, 1 ГБ, 2 ГБ and a free value in megabytes) enabled through a new prop `canEditQuota` that the host passes when the session user role is `admin`, saving through the settings client and refreshing the usage bar; server tests (default 512 MiB, override enforced on write and reported in usage, non-admin PATCH 403, range validation) and a dom test for the dialog in both modes; `npm run kb:log -- make-project-quota` and the Make KB topic that describes limits. |
