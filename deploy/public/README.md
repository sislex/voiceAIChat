# Public minimal Sislexa

The smallest Sislexa for open registration (target: `sislexa.by`): sign-up and sign-in
(Identity), billing with a daily limit per user (free use), chat (Chat/Required only, text-only
turns, cheap models) and file storage for chat attachments and the «Файлы» section. There are no
machines, Make, projects, studio or Kanban.

| Service | Source | Notes |
|---|---|---|
| `voicechat` (Core) | this repository, `server-runtime` target | `VC_APPLICATIONS=chat,identity,storage=…`, `VC_CHAT_TEXT_ONLY=true`, `VC_CHAT_REQUIRE_BILLING=true` |
| `identity` | `ghcr.io/sislex/identity` (pinned) | open sign-up comes from Core `app_config` |
| `billing` | `ghcr.io/sislex/billing` (pinned) | `BILLING_DAILY_USER_MICRO_USD` |
| `storage` | `sislex/storage` checkout, `apps/service/Dockerfile` | legacy Core sign-in mode |
| `storage-node` | this repository, `file-storage-node` target | one node with a data volume |
| `postgres` | `postgres:16-alpine` | Core and Identity share database `sislexa`; storage uses its own database `storage` (created by `postgres-init.sql`), because Core's embedded storage tables have the same `storage_*` names |
| `caddy` | `caddy:2-alpine` | automatic Let's Encrypt for `PUBLIC_DOMAIN` and `www.` |

Defaults (`scripts/public-build.mjs`, `DEFAULTS`): models `codex:gpt-5.6-terra,codex:gpt-5.6-luna`,
daily limit $0.10 per user (`100000` micro-USD, `Europe/Minsk`), storage quota 50 MB per user.

## Commands

| Command | What it does |
|---|---|
| `npm run public:install -- [options]` | creates the private state: settings, secrets, component tokens, storage credentials |
| `npm run public:docker -- [--project P]` | builds and starts the Compose project, then enables sign-up and narrows the tariff to `chat.use` |
| `npm run public:docker:down -- [--project P]` | stops the project and removes its volumes (all data) |
| `npm run public:dev` | runs the same services from working copies (SQLite instead of Postgres; the storage service restarts on source changes and its web bundle is rebuilt on every edit, so a storage design change shows after a page reload), logs in `.public/dev/logs` |

Install options: `--mode docker|dev`, `--state DIR` (default `.public/<mode>`), `--domain`,
`--url`, `--tls <acme e-mail>` (default `admin@<domain>`), `--http-port`, `--https-port`, `--runner-url`,
`--runner-token-file`, `--smtp-url`, `--storage-source <sislex/storage checkout>` (test stand only), `--models`,
`--daily-micro-usd`, `--quota-bytes`, `--admin-password`. Without `--domain`, Docker serves plain HTTP on
`http://localhost:29080` (storage UI on `http://127.0.0.1:29080`); dev uses `http://127.0.0.1:29273`.
`public:dev` expects working copies of Identity, Billing, storage and Core UI next to each other
(`--workspace`, default `~/sislexa-dev`).

## Deploying on a clean server

1. Install Docker with Compose; open ports 80 and 443.
2. DNS: `A` records for `sislexa.by`, `www.sislexa.by` and `files.sislexa.by` → the server address.
3. Clone this repository and `sislex/storage` side by side; run `npm ci` in this repository
   (the installer uses the component runtime).
4. `npm run public:install -- --domain sislexa.by --tls admin@sislexa.by --runner-url <url> --runner-token-file <file> --smtp-url smtp://…`
5. `npm run public:docker`
6. The administrator account is `admin`; its password is `PUBLIC_ADMIN_PASSWORD` in the state `.env`.

The LLM runner must be reachable from the server (`PUBLIC_RUNNER_URL`) and must report
`accountingVersion: 1`; billing settles every turn through it. Without SMTP, confirmation and
password reset links are only written to the Identity log.

## Operations

- Component tokens live 30 days. Renew them with
  `bash scripts/prod/component-rotation.sh --project sislexa-public` (root; `--dry-run` first),
  or install its daily timer (`scripts/prod/component-rotation.sh --install`, add `--project` to
  the unit's `ExecStart` when the host runs more than one installation).
- Storage reads Core's Identity token from `components/core/outgoing/identity.token` directly;
  the rotation restarts storage together with Core, so nothing is copied by hand.
- Change the daily limit with `npm run public:limit -- --usd 0.25` (add `--mode dev` for the dev
  build, `--time-zone Europe/Minsk` to change the day boundary): it updates the saved `.env` and
  Billing's stored policy together and restarts Billing.
- Back up the `postgres`, `core-data`, `billing-data` and `storage-blobs` volumes
  and the state directory.
