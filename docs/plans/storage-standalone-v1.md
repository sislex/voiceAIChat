# storage-standalone-v1: file storage as an independent product

Owner request (2026-11-01): file storage becomes an independent project with its
own address. A user opens the storage URL directly. Without a session the user is
sent to the login page on the Sislexa (Core/Identity) URL, signs in, and is
redirected back to storage. Storage shows the user's folders and files and lets
the user manage them and see the quota. Chat and Make keep accessing storage as
today, and the user sees the chat and Make folders in storage too.

## Current state (Core 0.1.517)

- `packages/file-storage`: blob node, HTTP node client and coordinator library.
- `apps/server/src/fileStorage`: `/api/storage/*` routes, SQL metadata
  (`db.storageMetadata()`), runtime (node health and quota from Identity).
- Spaces have kinds `personal`, `chat` (ref = conversation id) and
  `make-project` (ref = project id); the owner is the user, so chat and Make
  spaces already belong to the user.
- Quota: Identity `storageQuotaBytes`, default 100 MB, counted per space owner.
- Make (`VC_MAKE_FILE_STORAGE=service`) and Core UI use Core `/api/storage/*`.

## Decisions

1. **Repository `sislex/storage`** (private, base branch `dev`) owns the coordinator
   service, its metadata database, the blob node, the storage web UI and the
   migration tool. `@voicechat/shared/fileStorage` stays the public contract;
   Storage pins the shared archive like other owners.
2. **Storage is an external Sislexa application** (application id `storage`).
   Browser entry uses the existing Core application enter tickets:
   - unauthenticated request to storage UI -> 302 to
     `<core>/applications/storage/open?return=<path>`;
   - Core: no session -> Identity `/login/?next=<that url>`; with a session ->
     issue an enter ticket and 302 to `<storage>/_sislexa/enter?core=…&ticket=…&return=…`;
   - Storage redeems the ticket at `<core>/internal/v1/tickets/redeem` with
     `VC_APPLICATION_STORAGE_TOKEN`, creates its own session cookie (HttpOnly,
     SameSite=Lax, CSRF header for mutations) and redirects to `return`;
   - Storage revalidates the session with Core like other external apps; logout
     clears the storage session.
3. **Personal API tokens**: `Authorization: Bearer <Identity API token>` is
   accepted by Storage through Identity introspection (read-only tokens can only
   read).
4. **Core -> Storage** (chat uploads, attachment reads, Make proxy, Core UI Files,
   admin usage/quota): Core uses `VC_FILE_STORAGE_MODE=remote`,
   `VC_FILE_STORAGE_URL` and a service credential, and asserts the acting user in
   `x-sislexa-user` (+ tenant). Storage trusts that header only together with the
   Core service credential. Core keeps `/api/storage/*` as a streaming proxy, so
   Make and Core UI keep working unchanged; `embedded` mode stays for
   compatibility until migration.
5. **Quota** stays in Identity (`storageQuotaBytes`); Storage reads it with its
   own component credential. Core admin "Пользователи" keeps showing usage and
   editing the quota (usage read from Storage).
6. **Storage UI** groups spaces: «Чаты» (kind chat, titled by conversation),
   «Проекты Make» (make-project), «Личные», «Доступные мне» (shares/links).
   Folders, upload (chunked/direct/resume), download, preview, rename/move,
   delete, share by user or link, quota bar, logout. Mobile layout.
7. **Migration**: a tool copies spaces, entries, shares, link acceptances and
   uploads metadata from the Core database to the Storage database; blob nodes
   and their data are reused unchanged. Dry run + counts check.

## Tasks

Core (repository voiceAIChat, workers):
- **C1** application `storage` + browser entry `GET /applications/:id/open`.
- **C2** remote storage mode in Core (`VC_FILE_STORAGE_MODE=remote`).

Storage (repository sislex/storage, after the repository and Kanban project exist):
- **S1** standalone coordinator service with its own metadata DB.
- **S2** authentication: enter tickets, own session, API tokens, Core service calls.
- **S3** storage web UI.
- **S4** migration tool Core DB -> Storage DB.
- **S5** packaging: Docker image, compose profile, dev stand on M2, release.

C1, C2, S1, S2, S3 run in parallel; S4 after S1; S5 after S1-S3.
Integrator (operator): shared archive pin, stand verification
(http://127.0.0.1:25273 chat/Make + storage URL), release.
