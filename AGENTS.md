# voiceAIChat agent instructions

The product is **Sislexa**. This repository is its Core service. Read this file
at the start of every session; load package instructions and `docs/kb/` only when
the task needs them. Keep this file small.

## Start every task

1. Run `git status --short --branch` and `git fetch origin`.
2. If a clean `main` only trails `origin/main`, fast-forward it. With local
   changes, diverged history, or another branch, do not switch or overwrite;
   report the state and ask the user how to proceed. Read-only inspection may use
   `origin/main` when the checkout is stale.
3. Before code research, run `npm run kb:context -- "<task>"` and open only the
   returned topics and relevant package `AGENTS.md` files.

Do not commit or push without a direct user request.

## Repository ownership

| Path | Package | Responsibility |
|---|---|---|
| `packages/shared` | `@voicechat/shared` | REST/WS contracts, types, pure logic ([instructions](packages/shared/AGENTS.md)) |
| `packages/component-runtime` | `@sislexa/component-runtime` | Component tokens, grants, compatibility and managed configuration ([instructions](packages/component-runtime/AGENTS.md)) |
| `apps/server` | `@voicechat/server` | Fastify Core, persistence and orchestration ([instructions](apps/server/AGENTS.md)) |

Product apps, Core UI, UI libraries, SDK, Identity, Billing, LLM Runner, Agent
and Desktop are versioned dependencies owned by separate repositories. Their
implementation and internal tests do not belong here. Core keeps public contract,
authorization, transport and browser integration checks. See
[repository ownership](docs/kb/architecture.md#tool-repository-ownership),
[Core UI distribution](docs/kb/clients.md#core-ui-distribution) and
[test ownership](docs/kb/testing-operations.md#core-ui-test-ownership).

## Commands

```bash
npm install                  # Core workspaces only
npm run dev:web              # Core :8787 and published UI proxy :5273
npm run gate:fast            # changed worktree since HEAD; use during a step
npm run gate                 # branch diff from origin/main; use before commit/PR
npm run gate:app -- core     # complete Core application gate
npm run gate:all             # complete Core checks and consumer integration
npm run gate:release         # Core + performance + owner system acceptance
npm run test:coverage        # shared/server coverage ratchet
npm run docker               # compose stack at http://localhost:8787
npm run kb:check             # report stale knowledge topics
```

The user owns the development server. Do not leave a process on port `8787`;
when execution is necessary, ask the user or use another port such as `8799`.

## Required gate

A step is complete only after the selected packages pass typecheck and tests;
UI/build changes also require their selected build. Add tests in the same step as
the implementation.

Use the gate planner rather than assembling commands manually. `gate:fast` selects
complete owner suites from the worktree diff; `gate` uses the whole branch diff.
Public contracts add consumer checks, browser changes add owned E2E, and unknown
root/config/lock changes fall back to `gate:all`. Run product-internal gates in
their owner repositories. Never replace an application suite with `vitest related`.
Trust the command exit code, not filtered output. Full details and long-run support:
[testing conventions](docs/kb/conventions.md) and
[testing operations](docs/kb/testing-operations.md#development-gate-npm-run-gatefast).

## Core invariants

- `packages/shared` is the source of truth for public contracts. Change the
  contract first, then server and consumers. Keep message-type registries in sync.
- The server runs TypeScript through `tsx`; relative imports in `apps/server`
  therefore use `.js` extensions even though the source files are `.ts`.
- Write new documentation and code comments in English. Keep tests beside source
  as `*.test.ts` or `*.dom.test.tsx`.
- Communicate with the user in Russian unless they explicitly request otherwise.
- Never edit the production data checkout. Development happens in this clone;
  release automation manages `VC_REPO_DIR`. See [deployment](docs/kb/deploy.md).

## Knowledge base

Use the generated [KB index](docs/kb/README.md) to find a topic. Frequent entry
points are [architecture](docs/kb/architecture.md),
[contracts](docs/kb/protocol.md), [server](docs/kb/server-internals.md),
[auth/data](docs/kb/data-auth.md), [testing](docs/kb/testing-operations.md),
[deployment](docs/kb/deploy.md) and [conventions](docs/kb/conventions.md).
Historical plans in `docs/plans/` are context, not current truth.

If KB lookup was incomplete and code research established the answer, update the
existing relevant topic. After any behavior or KB change:

1. Run `node scripts/kb.mjs touch <topic>`.
2. Run `npm run kb:log -- <short-slug>`.
3. Run `npm run kb:index`.
4. Keep KB changes with the implementation commit.

Do not hand-edit generated `docs/kb/README.md`. The complete workflow is in
[kb-workflow.md](docs/kb/kb-workflow.md).
