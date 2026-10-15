# B03 verification evidence

The assigned base `42c88c8dafd01af5927a5117679c84b9d907bfdb` already contains
the complete implementation. This attempt verifies it and updates evidence only.

- Fake package gates use promise barriers for serial and parallel runs.
  Assertions retain worker allocation checks and maximum concurrency (1 / 2),
  and verify both packages start each stage before either finishes.
- Heartbeat verification polls for output and always stops diagnostics.
- Detached metadata/completion polling and the controlled launcher timeout use
  a 60-second host budget. Polling checks immediately, then every 20 ms, without
  delaying successful runs. No shared timeout environment override was found
  in repository scripts.

## Commands and results

Test commands use `TMPDIR="$DELIVERY_ATTEMPT_ROOT/tmp"`. Successful full-file
runs use `/bin/bash` with `login: false`. Logs live in the assigned attempt's
`artifacts` directory.

1. `node --test scripts/affected-check.test.mjs`, five consecutive runs:
   all exited 0, each with 62 passed and 0 failed. Durations: 48.691, 36.948,
   32.101, 32.245 and 32.978 seconds. Logs: `b03-bash-repeat-{1,2,3,4,5}.log`.
2. The same command with four background `yes > /dev/null` processes: exit 0,
   62 passed, 0 failed, 73.921 seconds (`b03-load.log`). All four PIDs passed
   `kill -0` before testing; an EXIT trap killed and waited for them afterwards.
3. `node --test --test-name-pattern='диагностика молчит|runPackageGates ограничивает' scripts/affected-check.test.mjs`:
   exit 0, 2 passed.
4. `node --check scripts/affected-check.test.mjs`: exit 0.
5. `node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext --skipLibCheck scripts/affected-check.test.mjs`:
   exit 2, 11 existing diagnostics in the unchanged test and imported
   `affected-check.mjs`. No source or package changes were needed in this attempt.
6. `npm run gate:task -- --base 42c88c8dafd01af5927a5117679c84b9d907bfdb`:
   exit 0. The affected planner selects `npm run kb:check`: implementation is
   already in the base and only evidence changes. KB reports existing stale
   topics and missing package instructions.
7. `git diff --check`: exit 0.

Initial default-login-shell executions encountered environment errors: five
full-file runs exited 1 (34 passed, 28 failed; `b03-repeat-{1,2,3,4,5}.log`), and
a direct diagnostic returned `spawnSync bash EPERM`. The initial task gate
exited 255 without diagnostics. Ordinary Bash runs work without changing
sandbox permissions and supersede those initial results.

`git fetch origin` was denied writing `.git/FETCH_HEAD`; the isolated checkout
was already clean at the assigned base. No dependency context directory was
present. No full/release gate, commit, push, deployment or persistent service
was started.
