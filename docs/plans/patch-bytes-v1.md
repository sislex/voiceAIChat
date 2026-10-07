# patch-bytes-v1 — патч попытки байт в байт (delivery-control #242)

Ран `patch-bytes-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: создать план для delivery-control #242 и запустить.

## Что видно сейчас

В `artifacts/changes.patch` попыток встречается U+FFFD (`��`) вместо отдельных кириллических букв — и в
удаляемых, и в добавляемых строках (kb-service-v3 B04, B09, C01; kb-service-v4 C01 — 5 строк). `git apply`
отвергает такой патч, а испорченный текст может уйти в `main`; оператор восстанавливает строки из базы.

Причина: `src/worker/guardian.ts` пересылает вывод команды кусками и переводит каждый кусок в строку
отдельно (`b.toString()`), поэтому двухбайтовая буква на границе куска превращается в `��`. Патч
собирается из этого текстового вывода `git diff --cached --binary HEAD` (`capturePatch` в
`src/worker/attempt.ts`), так что не-UTF-8 байты бинарных патчей тоже портятся.

| B01 | delivery-control | — | Byte-exact attempt patches (delivery-control #242). (1) `src/worker/guardian.ts`: decode each child stream with one `StringDecoder('utf8')` per stream (or `setEncoding('utf8')`) so multi-byte characters split across chunks are never replaced by U+FFFD; flush the decoder on end. (2) `capturePatch` in `src/worker/attempt.ts`: produce the patch bytes directly with `git diff --cached --binary HEAD --output=<file>` (or a buffer-returning command) instead of the text output of the command runner; use the exact bytes for `artifacts/changes.patch`, the patch hash, the secret scan input (decode as UTF-8 only for scanning) and the uploaded artifact, so the stored artifact is byte-identical to git's output. (3) Tests: a command whose stdout splits a Cyrillic letter across two chunks is returned unchanged; a repository change with a long Cyrillic file (> 64 KiB, so the output spans many chunks) and a small binary file produces a patch byte-identical to `git diff --cached --binary HEAD` and `git apply --check` succeeds on the base; the uploaded artifact sha256 equals the file sha256. Update docs (worker attempt lifecycle / artifacts). Gate: `npm run gate:task -- --base <sha>`. |
