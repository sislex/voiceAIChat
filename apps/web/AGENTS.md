# @voicechat/web — браузерный клиент

Намеренно почти пустой: вся логика и UI — в `@voicechat/ui`, контракт — в
`@voicechat/shared`. Здесь только три вещи.

- `src/bridges/config.ts` — адрес сервера: `VITE_SERVER_URL` или `''`
  (same-origin, когда web раздаётся тем же сервером / через dev-proxy Vite).
- `src/main.tsx` — `installRemoteBridges(SERVER_HTTP)` **до** монтирования (стор
  читает `window.*` при инициализации), затем `<App/>` и `@voicechat/ui/styles.css`.
- `vite.config.ts`, `index.html`.

**Фичу писать здесь не нужно** — она пишется в `packages/ui` и тогда появляется и
в desktop. Правки в этом пакете уместны, только если речь про сборку, адрес
сервера или инициализацию.

Dev: `npm run dev:web` из корня (сервер :8787 + Vite вместе).
Прод-сборка: `npm run -w @voicechat/web build` → `dist/`, раздаётся сервером через
`VC_WEB_DIR`. В Docker собирается **без** `VITE_SERVER_URL` — same-origin.

Гейт: `npm run -w @voicechat/web typecheck` (+ `build`, если менялась сборка).
