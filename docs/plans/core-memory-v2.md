# core-memory-v2 — ядро прода упало по нехватке памяти

Ран `core-memory-v2` (повтор `core-memory-v1`). Ветка задач — `dev`.

## Что случилось (2026-10-09)

Ядро прода 0.1.428 (`voiceaichat-voicechat-1`, `mem_limit: 1g`, запуск `node --import tsx src/index.ts`
без `--max-old-space-size`) упало через 12 минут после старта: `FATAL ERROR: Reached heap limit
Allocation failed - JavaScript heap out of memory`, последний Mark-Compact 508.6 → 508.4 МБ. В эти
минуты шла регрессия релиза 0.1.429, и ядро в основном обслуживало `POST /internal/kanban/exec-stream`
(12 запросов) — поток вывода команды машины через ядро в Kanban. Регрессия упала на
`connect ECONNREFUSED 172.23.0.20:8787` в момент перезапуска. После перезапуска ядро 2,5 часа держится
на ~220 МБ без роста, следующая регрессия прошла без падения: это всплеск, а не постоянная утечка.

## Что известно о коде

- `apps/server/src/agents/registry.ts`: у потокового exec каждый `exec.chunk` сразу уходит в
  `onChunk`, внутренний буфер не растёт (обычный exec ограничен `OUTPUT_CAP_BYTES`).
- `apps/server/src/internal/execStream.ts` `serveExecStream`: каждый кусок пишется
  `raw.write(JSON.stringify({chunk}) + '\n')` без учёта обратного давления. Если Kanban читает медленнее,
  чем агент шлёт вывод (тесты регрессии печатают мегабайты), весь вывод копится в памяти ядра в
  буфере ответа. Это главный подозреваемый, но снимка кучи нет — причина не доказана.

## Попытка 1 (core-memory-v1, 2026-10-10)

Патч добавил обратное давление в `serveExecStream`, `processMemory.ts`, флаги Node в compose и записи KB, но
`gate:task` упал: новые тесты `execStream.server.test.ts` («bounds 50 MiB with a paused socket…»,
«cancels the command when the consumer disconnects» — таймаут 60 с) и существующий `execStream.test.ts`
(«строка error — исключение с текстом ядра») падают с `read ECONNRESET`. Сервер рвёт соединение вместо
того, чтобы дописать финальную строку `error`/`result` и штатно завершить ответ; клиент `execOverHttp` обязан
по-прежнему получать текст ошибки ядра (`machine_offline`), а не ECONNRESET. Нагрузочный тест с paused socket
должен укладываться в секунды, а не в минуту: бюджет гейта — 100 тестов / 60 с.

| B01 | Core | — | Core heap exhaustion during release regression, per docs/plans/core-memory-v1.md (copy in this repository): (1) bound memory in `apps/server/src/internal/execStream.ts` `serveExecStream`: track `raw.writableLength`; above a high-water mark (8 MiB) stop forwarding chunks, count the dropped bytes, and when the response drains below a low-water mark (1 MiB) write one NDJSON line `{"chunk":"\n…[stream output dropped: <n> bytes, consumer too slow]\n"}` before resuming; never buffer more than the high-water mark plus one chunk; keep the existing cancel-on-close and final `result`/`error` line; (2) apply the same bound to every other route that relays agent output as a long-lived HTTP stream (`/internal/machines/exec-stream`, any PTY/log relay found by searching `raw.write` in apps/server/src) or document why it is already bounded; (3) diagnostics for the next incident: in `docker-compose.yml` the `voicechat` service runs Node with `--max-old-space-size=768` and `--heapsnapshot-near-heap-limit=1 --diagnostic-dir=/data/diagnostics` (keep `mem_limit: 1g`; create the directory at startup; at most one snapshot is kept — remove older `*.heapsnapshot` files there on start) and document the location in docs/kb/deploy.md; (4) a periodic memory line: every 5 minutes log one JSON event `{"event":"process_memory","rss","heapUsed","heapTotal","external","arrayBuffers"}` in MiB so the growth before a crash is visible in `docker logs`; tests: a slow consumer (paused socket) receiving 50 MiB of chunks keeps `writableLength` under the high-water mark and gets the dropped-bytes line then the final result; fast consumers get every byte unchanged; cancel on close still cancels; the memory logger interval is unref'd and stoppable. Attempt 1 findings are in this plan's «Попытка 1» section: never destroy the response socket on overflow, cancel or error — always write the final `result`/`error` line and end the response normally so `execOverHttp` keeps its error semantics (existing `execStream.test.ts` must stay green); keep the paused-socket test within seconds. Update docs/kb/server-internals.md and docs/kb/deploy.md. Gate: `npm run gate:task -- --base <sha>`. |
