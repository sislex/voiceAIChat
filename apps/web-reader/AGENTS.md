# Web Reader

Самостоятельный `@voicechat/web-reader`: HTTP-прокси `/api/preview*`, MCP browser
`/mcp/preview`, cookie-контейнер и iframe из `apps/web-recorder`. UI-панель хоста
выпускается отдельно как `web-reader-ui` (`packages/web-reader-app`).

Данные и права — только через `ReaderCore` из `@voicechat/web-reader-contracts`.
БД, WS-сессии, машины, кадры CI остаются у ядра. Нельзя импортировать исходники
`apps/server`, `apps/playwright-reader` или runtime Chromium. Playwright вызывается
через `@voicechat/playwright-reader-contracts`, валидация host aliases — через
`@voicechat/browser-contracts/security`. Все runtime-зависимости объявляются здесь,
а не берутся случайно из корневого node_modules; это проверяет boundary.test.ts.

`src/module.ts` — embedded-композиция; `src/standalone/index.ts` — порт 8795.
Env: `VC_CORE_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`,
`VC_PLAYWRIGHT_READER_URL`, опционально `VC_BROWSER_HOST_ALIASES`.
У ядра `VC_READER_MODE=remote`, `VC_READER_URL`; прокси также отдаёт `/web-recorder/`.
Общая БД и том ядра не нужны. Cookie сайтов в памяти: рестарт сбрасывает входы.

Гейт: `npm run gate:app -- web-reader`. Он проверяет API, рекордер, адресные
контракты ядра и E2E. `release.json`, `container.json`, `compatibility.mjs` —
независимая сборка и выпуск. Нужен API core >=1.1.0, Playwright API >=1.0.0;
конкретные версии и верхние границы фиксируются манифестом выпуска.
