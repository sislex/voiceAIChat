# storybook-bridge-v1 — Storybook Core UI в проекте Make

Ран `storybook-bridge-v1`. Ветка задач — `dev`.

Владелец, 2026-10-09: проект Make должен показывать компоненты Sislexa (Storybook), чтобы по ним говорить,
что поправить. Make запускает Storybook рабочей копии `sislex/sislexa-core-ui` на машине проекта командой
`<команда> --port <p> --no-open --ci` и показывает кадр через мост машины (`/api/preview?url=…machine.internal`).

| B01 | core-ui | — | Make Project mode shows this repository's Storybook through the Core machine bridge, which proxies HTTP but not the Vite HMR WebSocket. In that frame `@vite/client` logs `[vite] server connection lost. Polling for restart...` and reloads the iframe in a loop, so no story ever renders (seen on production for `chat-chatcolumn--conversation`). (1) In `packages/ui/.storybook/main.ts` `viteFinal`, when `SISLEXA_STORYBOOK_HMR=0` (or `off`) set `server.hmr = false` so the Vite client does not open a socket and never reloads; keep HMR on by default for local development. (2) Add a root script `"storybook": "npm run -w @voicechat/ui storybook --"` so Make's default command `npm run storybook -- --port <p> --no-open --ci` starts the showcase from the repository root (extra flags reach `storybook dev`; the package script's `-p 6006` must not override the passed `--port`: change the package script to `storybook dev` with the port supplied by callers, defaulting to 6006 via a separate `storybook:local` script or `${PORT:-6006}`). (3) Document in the package README/AGENTS how Make should start it: `SISLEXA_STORYBOOK_HMR=0 npm run storybook --`. Add a unit test for `viteFinal` (HMR disabled only with the variable) and a script test that the root `storybook` script forwards `--port`. Gate: `npm run gate:task -- --base <sha>`. |
