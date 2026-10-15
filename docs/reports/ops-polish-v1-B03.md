# B03 verification evidence

Implementation is complete; sandbox verification is incomplete.

- Fake package gates use promise barriers for both serial and parallel runs.
  Assertions retain worker allocation checks and maximum concurrency (1 / 2),
  and verify that both packages start each stage before either finishes.
- Heartbeat verification polls for output and always stops diagnostics.
- Detached metadata/completion polling and the controlled launcher timeout use
  a 60-second host budget. Polling checks immediately, then every 20 ms; a
  successful run does not wait out the budget. No existing shared test-timeout
  environment override was found in this repository.

## Commands and results

All test commands used `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp"`.
Logs are in `$DELIVERY_ATTEMPT_ROOT/artifacts/b03-*.log`.

1. `node --test scripts/affected-check.test.mjs`, five consecutive runs:
   each exited 1, with 34 passed and 28 failed. Child-process fixtures cannot
   launch: a direct `spawnSync('bash', ['-c', 'exit 0'])` diagnostic returned
   `status: null`, `spawnSync bash EPERM`. Missing fixture output files are
   consequent failures. Both changed in-process tests pass in every run.
2. The same command with four background `yes > /dev/null` processes:
   exit 1, 34 passed / 28 failed. The shell reported
   `nice(5) failed: operation not permitted`; artificial load was not verified.
   An EXIT trap killed and waited for all four recorded process IDs.
3. `node --test --test-name-pattern='диагностика молчит|runPackageGates ограничивает' scripts/affected-check.test.mjs`:
   exit 0, 2 passed.
4. `node --check scripts/affected-check.test.mjs`: exit 0.
5. `node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext --skipLibCheck scripts/affected-check.test.mjs`:
   exit 2, 11 diagnostics. The identical command against a temporary copy of
   `HEAD:scripts/affected-check.test.mjs` also returned 11 diagnostics; after
   normalizing file names, positions and ordering, diagnostics are identical.
   The temporary baseline file was removed. No new type errors remain.
6. `npm run gate:task -- --base 1e67649a41599c5d671882fcf44ed8cb515ded21`:
   exit 255 immediately after the npm command header, without further diagnostics.
7. `git diff --check`: exit 0.

The supervisor must rerun the five full-file checks, a verified load run and
the required task gate outside this sandbox. No full/release gate, commit,
push, deployment or persistent service was started.
