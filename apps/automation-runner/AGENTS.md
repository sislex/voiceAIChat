# Automation Runner

Follow the [root instructions](../../AGENTS.md).
Read [runner integration](../../docs/kb/features/ci-runner.md) and
[the service contract](../../docs/automation-runner.md) before changes.

The package exports src/server.ts; src/index.ts owns process startup.
Preserve bearer authentication on /v1 routes, durable queue state and injected
executor/machine/LLM ports. Keep tests beside the implementation.
