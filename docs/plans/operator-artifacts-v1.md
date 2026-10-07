# operator-artifacts-v1 — оператор скачивает артефакты попыток одной командой

Ран `operator-artifacts-v1`. Ветка задач — `dev`.

Владелец, 2026-10-07: включить в план задачу delivery-control #243. Приёмка задач с M1 занимала
5–30 минут: патч попытки забирался через `inbox shell` кусками по 2,5 КБ. Координатор уже хранит
артефакты по 64 КБ и отдаёт их оператору (`/v1/operations` — список, `/v1/evidence/:id/chunks/:index` —
куски с sha256): патч B03 kb-service-v3 (1 МБ) скачался за секунды. Не хватает команды CLI.

| B01 | delivery-control | — | Operator artifact download in the CLI. Add `control artifact list ATTEMPT` (name, kind, bytes, sha256, state of every artifact of the attempt, from `GET /v1/operations` `artifacts`) and `control artifact get ATTEMPT NAME --out FILE [--force]`: find the complete artifact by attempt id and name, download all chunks from `GET /v1/evidence/:id/chunks/:index`, verify each chunk sha256 and the whole-artifact sha256, write atomically (temporary file in the target directory, mode 0600, rename), refuse to overwrite an existing file without `--force`, print one JSON line `{attemptId, name, bytes, sha256, out}`; clear errors for unknown attempt or name, incomplete or purged artifacts and digest mismatches (nothing written). Use the existing CLI token/URL handling. Tests with the CLI test fake server (list, multi-chunk download, chunk and whole digest mismatch, incomplete artifact, existing file without and with --force). Document the commands in the operator docs (docs/ and the README command list). Gate: typecheck, build, `npm run gate`. |
