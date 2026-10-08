# storybook-bridge-v2 — Storybook без перезагрузок в кадре Make

Ран `storybook-bridge-v2`. Ветка задач — `dev`.

Продолжение [storybook-bridge-v1](storybook-bridge-v1.md): `server.hmr = false` не помогает — клиент Vite 5.4
(`node_modules/vite/dist/client/client.mjs`) всегда открывает сокет, а через мост машины Make (прокси
предпросмотра Web Reader) сокет открывается и закрывается; клиент пишет `server connection lost. Polling for
restart...` и перезагружает кадр по кругу (проверено на проде 2026-10-09 с `SISLEXA_STORYBOOK_HMR=0`).

| B01 | core-ui | — | Stop the Vite client reload loop when Storybook is shown through a bridge. In `packages/ui/.storybook/main.ts` `viteFinal`, when `SISLEXA_STORYBOOK_HMR` is `0`/`off` (already parsed there), keep `server.hmr = false` and add a serve-only Vite plugin (`apply: 'serve'`, `enforce: 'post'`) whose `transform(code, id)` matches the Vite client module (`/vite/dist/client/client.mjs`) and removes the WebSocket connection: replace the statement `socket = setupWebSocket(socketProtocol, socketHost, fallback);` with a no-op and guard uses of `socket` (`sendMessageBuffer`/`send` must not throw when there is no socket), so the client never calls `waitForSuccessfulPing` / `location.reload()`, while `updateStyle`, `removeStyle`, `createHotContext` and error overlay helpers keep working (CSS injection in dev depends on them). If the expected statement is not found, log one warning and leave the code unchanged. Without the variable the client is untouched. Tests: unit test of the plugin transform on a fixture copy of the 5.4 client snippet (socket statement removed, `updateStyle` export retained, no-op when the marker is missing, untouched without the variable). Document in `packages/ui/README.md` (or the place v1 documented `SISLEXA_STORYBOOK_HMR`) that the variable gives a static dev showcase for bridged frames (manual reload after edits). Gate: `npm run gate:task -- --base <sha>`. |
