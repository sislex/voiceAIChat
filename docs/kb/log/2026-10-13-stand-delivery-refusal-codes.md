# Stand delivery refusal codes

Core now exposes only the ten coordinator refusal codes declared in Shared's
`STAND_DELIVERY_ERROR_CODES`, preserving supported 400/403/409/503 statuses.
Error bodies are bounded to 4 KiB; extra fields, unknown codes and malformed or
oversized bodies retain the existing generic failure. Routes keep their shape.
See `docs/kb/server-internals.md`, section “Stand delivery to dev”.

Added coordinator stream-cap and refusal tests and route tests using the fake
coordinator. Task gate, focused test runner and both package typechecks exited
255 without diagnostic output in the restricted attempt environment; supervisor
verification remains required. KB log/index commands also exited 255; this entry
was written manually and the generated index was left unchanged.
