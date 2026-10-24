# SISL-774 implementation record

Repository implementation: scoped, hash-only historical journal verification.
Source task: SISL-771; reported run: 4fec4aaf-3645-4c71-9059-97c34501f71c.

## Historical claims — not independently verified

| Command ID | Claimed SHA256 | Observation |
| --- | --- | --- |
| c8855c44-89ff-4716-878d-5f8fb2126681 | c93b8b72d269858971335166311ca47d8ea2e3ccc0b1c7b548c4239ea2655f23 | Blocked: original source unavailable to this run |
| 020ee9a2-c0ef-44af-96cc-0a75a0e6508b | 00e1a74178882690bf78e1b6d4fedd18f81ab32657f7e5bb65e0a79a913a6562 | Blocked: original source unavailable to this run |

These are task-card claims, not hashes of bytes read during SISL-774. No source
path was supplied or invented. The reported external-task lookup denial is an
access gap, not evidence that the journals do not exist. Full acceptance remains
blocked until the originals can be commissioned and independently checked.

## Implemented boundary

The remote MCP tool `historical_evidence_verify` accepts a command UUID only.
The existing bridge secret is necessary but insufficient. A trusted adapter must
resolve the URL's existing run capability to an active run and explicit journal
grants. Core also verifies current project membership, expiry, project, machine
and cwd, before reading and before releasing a digest. No roots or host policies
are changed. Adapter errors are suppressed; only hash metadata is returned.

Production wiring is deliberately absent while source and authority access are
unavailable. The optional `BuildOptions.historicalEvidence` port fails closed by
default. Commissioning must reuse the run owner's existing authority, bind these
two command IDs to immutable original sources, and attach the existing capability
to that run's remote MCP URL. It must not grant a directory, discover private
paths, mint broader rights, or normalize/rewrite the original journal bytes.

## Repository validation

`apps/server/src/mcp/historicalEvidence.test.ts` uses synthetic bytes (including
CRLF and NUL) and checks byte-exact hashing, mismatch, missing source, expiry,
scope isolation, revocation, source replacement, bounded reading, sanitized
failures, and the authenticated MCP boundary. Synthetic checks do not establish
either historical claim.

Validation completed on the SISL-774 working tree:
- `npm run gate:fast`: exit 0; selected Core.
- Core typecheck/build passed; 213 test files passed, 3 skipped;
  2286 tests passed, 32 skipped.
- Knowledge typecheck/build passed; 4 test files / 19 tests passed.

No original journal, host credential, mirror, sandbox setting, transport repair
or UI implementation is changed. No private journal contents are committed.

