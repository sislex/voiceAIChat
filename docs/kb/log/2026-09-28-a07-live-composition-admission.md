# A07 live composition admission

The reviewed worker patch added a synthetic SDK host, an exact owner-composition
acceptance harness, delegated message persistence and failed-queue preservation.
The initial native attempt was blocked by an Identity billing subject mismatch;
Identity main `e33958be66c7a1f44b3cb4c6b4619f7c2fefe322` now returns the stable
account subject. Billing main `41263c7c20f8e852b508bbd76220245fbb62bd10`
adds the per-application token totals consumed by Analytics 1.3.0 at
`a85d8ff1dc1e3b4d5f9e2c7bf289669f0e9da942`. Core pins their clean owner
archives and exact source commits.

The loopback harness passed locally with the published Runner and its text-only
Claude invocation. It verifies a paid delegated turn, rotation/revocation,
settlement-response loss, restart, queue denial and account/application report
reconciliation. Codex text-only is unavailable in the pinned Runner; Core keeps
its fail-closed request. This test proves the supported Claude path only.

The default feature flag is disabled. Production commissioning and deployment
are separate from this development acceptance. See
`docs/plans/a07-acceptance-status.md` for the scenario and exact composition.
