# @sislexa/file-storage

Independent storage node, HTTP client and coordinator. Public types and pure
rules come from `@voicechat/shared/fileStorage`. This package has no Core server
imports. Core routes, SQL persistence, Identity lookup and health polling belong
to the host (FS-2).

## Node

`npm run start -w @sislexa/file-storage` runs the Fastify node on port 8795.
Set `VC_FILE_STORAGE_NODE_ID`, `VC_FILE_STORAGE_DIR`,
`VC_FILE_STORAGE_CAPACITY_BYTES` (nonnegative safe integer), and
`VC_FILE_STORAGE_TOKEN_FILE`. `HOST` and `PORT` override the bind address.
The token file is reread on every call for rotation; an empty/missing token
fails closed. All health/blob calls require authentication.

Alternatively set `SISLEXA_COMPONENT_CONFIG` to a component-runtime configuration
with a private registry and Core grants for `file-storage.blobs`. The included
`component-contract.json` provides that scope under application ID
`file-storage`; `SISLEXA_COMPONENT_CONTRACT` can override its path.
Managed authorization takes precedence over the static token file and enforces
scope, expiry and revocation through component-runtime. Set
`VC_APPLICATION_COMMIT` to the release SHA for managed metadata.

Each directory must be exclusively owned by one process. Stored blobs have
validated opaque IDs; writes publish with a same-directory temporary file and
atomic rename. Mutations serialize capacity checks and accounting. Startup
counts regular blob files, ignoring temporary files. Crash remnants named
`.tmp-*` can be removed while the node is stopped. There is no replication or
filesystem fsync durability guarantee. Capacity accounts published blobs; a
replacement temporarily needs extra physical disk space. ENOSPC/EDQUOT maps to
`storage_full`. Blob requests stream through temporary files, with a 1 GiB default
limit configurable by `VC_FILE_STORAGE_MAX_FILE_BYTES` on Core and nodes.

Build Docker target `file-storage-node`. The
[two-node compose example](../../deploy/compose.file-storage.example.yml)
uses distinct volumes and token files, with 10,000,000,000 and 60,000,000,000 bytes
of capacity. Create its private token files first. Ports bind only to localhost;
use a private network or TLS proxy between machines.

## Client and coordinator

`createStorageNodeClient({ id, url, token, fetchImpl? })` exposes
`health/put/get/delete`, rejects redirects, bounds requests to 60 seconds and
throws `StorageServiceError` with a contract `code`. `put(id, bytesOrStream, size?)`
accepts bounded streams; HTTP `get(id)` returns a Node readable stream. Consume
or destroy downloads. Clients share a keep-alive undici Agent with HTTPS HTTP/2
negotiation. `storageBytes` explicitly collects a body for legacy byte consumers.
`createFileStorageService(ports)` receives:

- `metadata: StorageMetadataStore`, `nodes(): StorageNodeClient[]`,
  `nodeInfo(): StorageNodeInfo[]` (the host's cached health).
- `quota(ownerId): Promise<number>`, `now(): number`, and `newId(): string`.
  IDs must be globally unique and unpredictable; use `crypto.randomUUID`.
  Quota fallback belongs to the host using Shared's `storageQuotaBytes`.
- Optional `onCleanupError(entry, error)` to queue orphan cleanup.

Every method takes the authenticated user ID first. The host must derive it from
its verified session, never from request input. Methods are `createSpace`,
`listSpaces`, `getSpace`, `updateSpace`, `deleteSpace`, `listEntries`, `readFile`,
`writeFile`, `deleteFile`, `move`, `usage`, `cluster`, `listShares`,
`createShare`, `revokeShare`, `describeLink` and `acceptLink`.
See [the implementation](src/service.ts) for inferred signatures.

`writeFile(userId, spaceId, path, bytes, { mimeType?, ifMatch?, createOnly? })`
checks the owner's quota, places on the online node with most free space, and
increments the revision. The host parses HTTP If-Match/If-None-Match into these
options. Streaming writes accept a readable and optional `size`; chat async
iterables use the optional `putStream` extension, without a buffering fallback.
The coordinator counts bytes, checks size and owner quota including active upload
reservations, verifies stream completion, and cleans failed uploads.
`readFileStream` returns `{ entry, bytes }` with a stream from HTTP clients;
`readFile` collects bytes for compatibility. `openFile` streams ranges and full
downloads. `listEntries` returns
`{ space, entries }`. Move is within one space and refuses an occupied target.
Owners manage spaces/shares; write collaborators manage files. Links require a
signed-in user even to describe them; acceptance makes the space visible.
Revocation removes the grant immediately while preserving other valid grants.

The metadata transaction encompasses permission, quota/revision checks, upload,
and metadata changes. SQL adapters must serialize conflicting operations across
all coordinator instances, roll back failures, and never retry a callback that
performed node I/O. `createMemoryMetadataStore()` provides this behavior for
tests with copy-on-write state and a shared transaction queue. Per-owner usage
is computed from entries, including all owned spaces.

Old blobs are removed only after committing their replacement. Metadata failure
cleans the new blob; post-commit cleanup failures report through
`onCleanupError` without undoing the successful operation. Deleting a file or
space removes metadata first, then cleans blobs. Offline cleanup can leave
unreferenced blobs: hosts should persist cleanup jobs and reconcile node storage
after crashes. Cached health can lag writes; node capacity checks remain
authoritative and can reject a placement with `storage_full`.

## Verification

`npm run typecheck -w @sislexa/file-storage`
and `npm run test -w @sislexa/file-storage` cover node atomicity/auth/capacity,
real HTTP client behavior, pooled capacity, quotas, sharing, revision conflicts,
concurrent coordinators and failure rollback.
