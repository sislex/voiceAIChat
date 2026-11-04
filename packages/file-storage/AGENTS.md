# File storage

Read [the package README](README.md) and [Core storage architecture](../../docs/kb/architecture.md#file-storage-service) before changing behavior.
The immutable public contract is `packages/shared/src/fileStorage.ts`.
Do not import `apps/server`; host integration and SQL belong to FS-2.

Preserve atomic blob replacement, serialized capacity accounting, owner quota
isolation, revision checks and immediate share revocation. Metadata adapters must
honor the transaction contract, including rollback and no callback retries.
Never log bearer tokens or link secrets. One node process owns one blob directory.
Run this workspace's typecheck/tests and `npm run gate:fast`.
