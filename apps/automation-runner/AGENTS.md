# @voicechat/automation-runner

Durable HTTP job execution service. Read the root AGENTS.md first.

- `server.ts` builds Fastify with injected store, executor and machine/LLM ports.
  All `/v1/` requests require the configured runner bearer token.
- `queue.ts` owns execution and cancellation; `store.ts` owns persisted jobs,
  idempotency keys, events and pause/resume state. Preserve restart behavior.
- Public contracts live in `packages/shared/src/automation.ts`.
  Keep Kanban workflow orchestration outside this service.
- Use `.js` relative imports for the `tsx` ESM runtime.
- Focused checks: `npm run -w @voicechat/automation-runner typecheck` and
  `npm run -w @voicechat/automation-runner test`.

See [runner operation](../../docs/automation-runner.md).
