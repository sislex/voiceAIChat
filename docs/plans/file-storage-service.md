# File storage service (v1)

Status: in progress (2026-10-31). Owner request: a separate storage library, kept in
Core for now and moved to its own repository later. It stores files for signed-in
users. Chat files and Make projects are the first consumers.

## Goals

- Several storage containers can run on different machines. Each container is given
  its own capacity; the pool is the sum. A 10 GB container plus a 60 GB container
  give 70 GB.
- Every user has a quota. Identity owns the value (`storageQuotaBytes`); when it is
  unset the default is 100 MB (`DEFAULT_STORAGE_QUOTA_BYTES`). Files count against the
  quota of the space owner, also when a collaborator writes them.
- Spaces group files: `personal`, `chat` (one per conversation) and `make-project`
  (one per Make conversation/project).
- Sharing works like Google Docs. A space can be shared with a specific user or with
  anyone signed in who opens a link. The permission is `read` (list and download) or
  `write` (also add, change, move and delete). The owner can revoke any share.

Out of scope for v1: replication between nodes, anonymous public links, versions
history, server-side search.

## Contract

`packages/shared/src/fileStorage.ts` is the source of truth:

- Types: `StorageNodeInfo`, `StorageClusterInfo`, `StorageUsage`, `StorageSpace`,
  `StorageEntry`, `StorageShare`, `StorageFileRef`, request and response shapes.
- Core REST: `STORAGE_REST` (`/api/storage/...`). File bodies are raw bytes.
  `PUT .../file?path=` honours `If-Match: <revision>` and `If-None-Match: *`.
- Node API: `FILE_STORAGE_NODE_PATHS` (`/v1/health`, `/v1/blobs/:blobId`), scope
  `STORAGE_NODE_SCOPE`.
- Errors: `StorageErrorCode` with HTTP statuses in `STORAGE_ERROR_STATUS`.
- Pure logic: path normalisation, permission order, quota arithmetic, cluster summary
  and node placement (`pickStorageNode`: the online node with the most free space).
- Chat history: `MessageAttachment.storage` and `UploadInfo.storage` reference a file
  in the service instead of a machine path.

## Architecture

```
Core UI / Make UI ──REST──▶ Core (storage module) ──▶ storage node A (10 GB)
                                │  metadata in Core DB ──▶ storage node B (60 GB)
                                └─ quota ◀── Identity (storageQuotaBytes)
```

- **Storage node** (`packages/file-storage`, process entry `node`): a small Fastify
  server that stores opaque blobs under `VC_FILE_STORAGE_DIR` and refuses writes past
  `VC_FILE_STORAGE_CAPACITY_BYTES`. It knows nothing about users or paths. Core
  authenticates with a component token (`file-storage.blobs`), the same mechanism as
  other components (`@sislexa/component-runtime`).
- **Coordinator library** (`packages/file-storage`, export `createFileStorageService`):
  spaces, entries, shares, quotas and placement. It receives ports: a metadata store,
  a node client, a quota source and a clock. It is embedded in Core in v1. When the
  package moves to its own repository, the coordinator can run as its own service
  behind the same REST contract.
- **Core module** (`apps/server/src/fileStorage/`): SQL metadata store (SQLite and
  Postgres), REST routes for `STORAGE_REST`, node registry from `VC_FILE_STORAGE_NODES`
  (JSON list of `{ id, url, tokenFile }`), node health polling, quota from Identity.
  `VC_FILE_STORAGE_MODE=off|embedded` (default `off`).
- **Chat**: when storage is enabled and the user setting `chatFilesBackend` is
  `storage`, `POST /api/uploads` writes into the conversation's `chat` space and returns
  `UploadInfo.storage`. Readers (`resolveUpload`, retouch, attachment preview) read
  through the storage module. Machine storage stays the default.
- **Make**: `MakeWorkspaces` gets a storage interface. A `file-storage` backend maps a
  Make project to a `make-project` space through Core's storage API, so several Make
  copies share project files without a shared disk. The local disk backend stays the
  default.

## Tasks

Workers run these in parallel against the contract above (base: dev with this plan).

| ID | Repository | Task | Depends on |
|---|---|---|---|
| FS-1 | voiceAIChat | `packages/file-storage`: storage node server, node HTTP client, coordinator library with ports, in-memory metadata store for tests, Dockerfile target and compose example with two nodes (10 GB, 60 GB) | contract |
| FS-2 | voiceAIChat | Core module: SQL metadata store and migrations, `STORAGE_REST` routes, node registry and health polling, quota from Identity with the 100 MB fallback, link acceptance, chat upload/read backend, KB | FS-1 |
| FS-3 | identity | `users.storage_quota_bytes`, `setUserStorageQuota`, admin API and admin UI field, profile shows quota | contract |
| FS-4 | sislexa-core-ui | Files panel (spaces, files, upload, download, delete, move), usage bar against quota, share dialog (user or link, read or write), link page `#/storage/link/:token`, chat attachments with `storage` refs, setting `chatFilesBackend` | contract archive |
| FS-5 | make | Storage interface behind `MakeWorkspaces`; `file-storage` backend over Core storage API; share a Make project through storage shares | contract archive |

Integrator steps (operator, not workers):

1. Publish the `@voicechat/shared` archive with the contract and pin it in consumers
   before FS-4 and FS-5 merge.
2. Run two storage nodes on the M2 dev stand (`~/sislexa-dev`) with 10 GB and 60 GB,
   enable `VC_FILE_STORAGE_MODE=embedded` in its Core, and check chat uploads and a
   Make project on `http://127.0.0.1:25273`.
3. Pin new Identity, Core UI and Make versions in Core.

## Acceptance

- Pool capacity equals the sum of online node capacities; a node going offline removes
  its capacity and makes its files report `node_unavailable`.
- An upload over the owner's quota fails with `quota_exceeded`; an upload larger than
  any node's free space fails with `storage_full`.
- A `read` share can list and download but not write; a `write` share can add, change,
  move and delete; revoking a share removes access immediately.
- A link share works for any signed-in user who accepts it, and never without sign-in.
- Concurrent edits with a stale `If-Match` revision fail with `revision_conflict`.
- Chat attachments stored in the service survive a Core restart and render in history.
- A Make project on the `file-storage` backend opens from two Make copies with the
  same files.
