# A07 exact-composition acceptance

The opt-in server-side synthetic SDK application exercises scoped Core REST/WS
access with a memory-only delegated credential. The loopback acceptance harness
uses the published Identity, Billing, Runner, SDK and Analytics packages. Only the
model CLI is synthetic: Runner launches the child and derives its own execution
receipt from the normal provider usage stream.

The scenario uses Claude because the pinned Runner has a verified text-only Claude
invocation. Its Codex invocation rejects `textOnly` before child startup. Core
keeps `textOnly` required for delegated turns; it must not silently grant Codex
tool access. A separate Runner implementation and safety review are needed before
external applications can use Codex. This is an explicit capability limit of the
current S3 composition, not a passing Codex test.

The scenario creates a scoped grant, connects the SDK, runs a paid text turn,
queues another request, rotates and revokes the grant, loses a settlement response,
then restarts Core/outbox. It asserts one Runner child, one application charge,
no dispatch of the queued request after its grant is lost, and exact Billing and
Analytics application totals after rename and revocation. Core persists delegated
text and marks rejected dequeued work failed/paused with its original grant
reference. The bearer is never stored in the queue or outbox.

The composition uses reviewed owner commits: Identity
`e33958be66c7a1f44b3cb4c6b4619f7c2fefe322` (stable account subject), Billing
`41263c7c20f8e852b508bbd76220245fbb62bd10` (application token totals),
Analytics `a85d8ff1dc1e3b4d5f9e2c7bf289669f0e9da942` (application projection),
SDK `f6313db5ff58cc35fa8dacc90b9844f9706dcfba`, and Runner
`097282f2418c245454fe963b10d9b61e0b4d814a`. The preflight checks the exact
archives, installed bytes, consumer lock and deployment lock.

Run `npm ci` and `npm run gate` on the final Core commit. The gate includes
`npm run gate:a07`, which uses disposable databases and loopback ports. Delivery
attempts must provide `DELIVERY_ATTEMPT_ROOT`, `DELIVERY_PORTS` (Core then Runner)
and `DELIVERY_DATABASE_NAME`; ordinary runs allocate their own temporary roots.
The feature flag remains false by default. Passing code acceptance does not
commission production or enable the external-chat feature there.
