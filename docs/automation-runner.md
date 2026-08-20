# Automation Runner

`@voicechat/automation-runner` is the durable execution-plane service for automation jobs. Its internal API uses protocol v1 from `@voicechat/shared` and every `/v1/*` request requires `Authorization: Bearer <VC_AUTOMATION_RUNNER_TOKEN>`.

The service stores jobs, immutable snapshots, ordered events, pauses and terminal results in SQLite under `VC_AUTOMATION_DATA_DIR`. WAL mode and a persistent Docker volume preserve them across restarts. Jobs left in `running` or `cancelling` are safely returned to `queued` during recovery; paused and terminal jobs remain unchanged. Idempotency is enforced by a unique dispatch key. Events have a stable UUID and a unique monotonic position per job; clients replay from `GET /v1/jobs/:id/events?after=<position>`.

Routes:

- `POST /v1/jobs` validates protocol v1 and creates or returns the job for an idempotency key.
- `GET /v1/jobs/:id` reads durable state and terminal result.
- `DELETE /v1/jobs/:id` cancels queued, active, or paused work.
- `POST /v1/jobs/:id/resume` consumes a pause response once.
- `GET /v1/jobs/:id/events` replays ordered events.
- `GET /v1/health` exposes only queue counts and dependency availability.
- `GET /v1/capabilities` exposes protocol versions, job types, and states.

The production Compose service has no host port mapping. It uses `vc-automation-data`, an authenticated healthcheck and the internal port 8800. The server-side `AutomationClient` is the transport boundary intended for transactional-outbox dispatch and event reconciliation.

Execution is injected through `AutomationExecutor`. Command implementations must use `MachineExecutionPort`; LLM implementations must use `LlmRunnerPort`. The runner package has no imports of Claude/Codex CLI or `child_process`. The process entrypoint currently fails jobs with `executor_adapter_not_configured` until the control-plane adapters are wired; this is deliberate fail-closed behavior, not local execution.
