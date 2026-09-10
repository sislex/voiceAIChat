# Make as a separate application: dependencies and extraction plan

This document records the original extraction plan and its September 7, 2026
progress. Paths and proposed endpoints below describe that stage. Current Make
code lives in `apps/make`, its UI in `packages/make-app`, and its ports in
`packages/make-contracts`. The independent release implementation is documented
in [application-independent-releases.md](application-independent-releases.md).

Original implementation: `apps/server/src/routes/make.ts` for REST, previews,
and publications; `apps/server/src/make/*` for workshops, snapshots, showcases,
imports, libraries, and events; `apps/server/src/mcp/makeMcp.ts` for assistant
`mcp__make__*` tools. UI components lived in `packages/ui/src/components/Make*.tsx`
over `window.api['make:*']` and `window.make.onChanged/onPresence` bridges.

## Purpose

Allow Make to change and release independently of chat, kanban, and authentication.
The data layer already has table ownership and asynchronous ports, described in
`docs/plans/db-repositories.md`. Make is a suitable first extraction because:

- **It owns no tables.** Its state is files at `<dataDir>/make/<conversationId>`:
  workshop files, snapshots, notes, comments, access grants, task links, and
  story PNGs.
- **Its core dependency is narrow:** the database methods listed below,
  read-only machine filesystem access, board notifications, and two WS frame types.
- **It has a separate model entry point:** the LLM runner accesses `/mcp/make`
  over HTTP and does not depend on where that URL is hosted.

The original plan excluded a separate UI bundle and assistant API keys. The UI
was initially kept in the shared host without changing bridge contracts. A later
release-boundary change extracted the Make panel; assistant API keys remain a
separate concern.

## Inventory as of September 7, 2026

Make backend code totaled 4,417 lines excluding tests.

| File | Lines | Responsibility |
|---|---|---|
| make/workspace.ts | 1,349 | Files, snapshots, notes, grants, comments, task links, quotas, sweep, promptContext, and adminStats |
| routes/make.ts | 1,020 | About 30 REST paths, Make and shared previews, /p/<token>/ publications, and /s/<slug>/ |
| mcp/makeMcp.ts | 275 | make_* tools, MakeTaskScopeBroker, and buildTaskMakeSources |
| make/stories.ts, transpile.ts, zip*.ts, importUrl.ts, library.ts, hub.ts, rateLimit.ts, metrics.ts | 773 | Showcase/tests, TSX transpilation, imports, component library, events, limits, and metrics |

The shared contract included `make*` REST paths in `protocol.ts`, `make:*`
bridges in `ipc.ts`, and server-to-client `make.changed` / `make.presence` frames.
Twelve Make UI components were mounted by `App.tsx`.
Browser coverage was `e2e/make.e2e.test.ts` using Playwright, TC-14.

## Make and core dependency map

### Data Make reads from core

| Domain | Methods | Purpose |
|---|---|---|
| chat | getConversation, conversationOwner | Ownership, assistantKind === 'make', and conversation project |
| chat | makeConversationProject, isMakeProjectViewer | Project-member access to another user's Make conversation |
| chat | listConversations(owner, { includeCompleted }) | All owner projects for quotas through setProjectsOfOwner |
| tasks | makeTaskLinks, linkTaskDesign, unlinkTaskDesign, makeLinkableTasks | Design-to-card links; tasks owns task_designs |
| tasks | getCiTask | Validate run-scope tokens through authorizeTaskSource |
| projects | getProject | Project name in the project-components panel |
| identity | getUser | Comment author name |

Other dependencies: `machineFs.list/read/isOnline` for read-only repository
access, `boardChanged(projectId)` after task linking, and `mcpSecret` for
`/mcp/make`.

### Data core reads from Make

| Consumer | Interface | Purpose |
|---|---|---|
| turns.ts | makeContext → workspaces.promptContext | Design tokens and open comments in prompts |
| turns.ts | hub.turnSnapshot(turn) | meta.makeSnapshotId for restoring assistant edits |
| turns.ts, ci/modelHooks.ts, task preparation in server.ts | buildTaskMakeSources and MakeTaskScopeBroker.issue | Scoped MCP URLs for task-design reads |
| routes/projects.ts | makeWorkspaces.list | Validate rework-cycle makeSources paths |
| routes/admin.ts | makeWorkspaces.adminStats | Per-user disk usage |
| server.ts | makeSweep timer | Remove snapshots and PNGs older than 30 days |
| session.ts / ws.ts | hub.subscribe(userId, sink) | Deliver Make change and presence frames |
| users/auth.ts, routes/invitations.ts, routes/imageStudio.ts | SlidingWindowLimiter | Shared utility, not a true Make dependency |
| routes/projectComponents.ts | parseStoryFile | Shared repository story parser |
| routes/admin.ts | formatMakeMetrics | Metric formatting |

The main reverse dependencies are prompt context, turn snapshots, run-scope
tokens, and path validation. Other consumers mostly used shared utilities that
happened to live in make/ for historical reasons.

## Proposed topology

```text
browser --HTTPS--> Caddy --+-- Make routes --> make:8788
                          +-- other routes --> voicechat:8787
LLM runner --> make:8788/mcp/make (VC_MAKE_MCP_PUBLIC_BASE)
make --> voicechat:8787/internal/* (VC_INTERNAL_TOKEN)
voicechat --> make:8788/internal/* (the same token)
```

Make routes include `/api/make/*`, `/api/preview/make*/*`, `/p/*`, `/s/*`, and
`/mcp/make`. Core supplies authentication, conversations, tasks, and user-socket
notifications; Make supplies promptContext, turnSnapshot, list, and adminStats.

- **One origin:** Caddy path routing preserves `vc_session` / `vc_csrf` cookies
  and same-origin iframe previews without exposing the split to the frontend.
- **One authentication authority:** Make does not read identity's sessions table
  or know sessionSecret. It forwards cookies/Bearer credentials to core's
  `/internal/whoami` and caches read authorization for 30 seconds. Mutations are
  checked individually. Session revocation can take up to 30 seconds to affect
  cached reads.
- **Existing data:** retain the same Make files on the mounted data volume;
  core stops writing workshop files directly. The original topology used
  `/data` and referred to `VC_MAKE_DIR=/data/make`; the standalone configuration
  now uses `VC_DATA_DIR` as its root.
- **MakeCore and MakeService ports:** local implementations use in-process
  objects and db.*; remote implementations use internal HTTP RPC.
- **Stateless run-scope tokens:** replace process-local Maps with HMAC documents
  and TTLs so core can issue tokens that Make verifies. The proposal mentioned
  VC_INTERNAL_TOKEN; the implementation signs them with the shared VC_MCP_SECRET.
- **Live frames:** Make sends events to core, which owns user sockets. The
  proposal used `/internal/ws/push`; implementation batches them through
  `/internal/make/events`. The external WS contract stays stable. Make-owned SSE
  is deferred.
- **Embedded mode:** `VC_MAKE_MODE=embedded` supports development, desktop, and
  tests. `remote` with `VC_MAKE_URL` selects the standalone service. Switching
  mode does not itself require rebuilding the core image.

## Implementation rounds

The original workflow required one commit per round, a successful `npm run gate`
exit code, and no data-schema changes.

### Round 1 — boundary inside the monolith ☑ (2026-09-07)

1. ☑ Move shared utilities out of make/: SlidingWindowLimiter to util/rateLimit.ts,
   parseStoryFile to util/storyParse.ts, and assertPublicHost to util/publicHost.ts.
   Keep formatMakeMetrics with Make, exposed through service.metrics().
2. ☑ Introduce MakeCore with conversation, conversationOwner, conversationProject,
   isProjectViewer, makeConversationIdsOf, taskLinks, linkTaskDesign,
   unlinkTaskDesign, linkableTasks, ciTaskDesigns, project, userName, boardChanged,
   and machineFs. LocalMakeCore receives db, agentRegistry, and boardHub. Routes
   and MCP accept MakeCore instead of VoiceChatDb; createMakeModule composes Make.
3. ☑ Introduce MakeService for promptContext, turnSnapshot, listFiles, adminStats,
   issueTaskScope, and sweep. Migrate turns, CI hooks, project/admin routes, and
   server composition to the port.
4. ☑ Replace the in-memory scope-token broker with HMAC and TTL tokens.
5. ☑ Add boundary checks preventing Make from importing db, users, agents, or
   turns. Core cannot import workshop/hub implementation outside composition.
6. ☑ Run MCP tests over a fake core; keep project-sync integration on LocalMakeCore
   because it needs real projects and machines.

### Round 2 — apps/make package and internal API ☑ (2026-09-07)

1. ☑ Physically move Make implementation into `apps/make/src`. Add
   buildMakeServer, forwarded authentication, HttpMakeCore, internal service RPC,
   health, listening, and sweep. Move SlidingWindowLimiter and parseStoryFile to
   shared.
2. ☑ Protect core's internal routes with VC_INTERNAL_TOKEN. Use method/args RPC
   at `/internal/make/core`, `/internal/make/events`, and `/internal/whoami`
   instead of the proposed per-method conversation/project/viewer/task-link/
   machine-filesystem REST resources and separate board/WS push endpoints.
   Caddy does not expose internal routes.
3. ☑ Add HttpMakeCore and core's createRemoteMake, selecting by VC_MAKE_MODE.
   Extract authenticate from the users/auth.ts preHandler and return it through
   registerAuth.
4. ☑ Forward `/api/*` authorization, caching reads by token and path class for
   30 seconds. Public links and MCP retain link/secret-based access.
5. ☑ Add local-versus-HTTP MakeCore contract tests over app.inject() and a
   two-process remote integration test covering Bearer, cookie/CSRF, route
   ownership, MCP, and rejection of internal requests without tokens.

### Round 3 — image, Compose, and Caddy ☑ (2026-09-07)

1. ☑ Add the make-runtime Docker target and Make Compose service at port 8788
   with core URL, shared secrets, existing data, and /v1/health. Configure core's
   remote mode/URL and the runner-visible MCP base URL.
2. ☑ Route Make paths to make:8788 in both Caddy hosts, hide internal paths,
   and keep other traffic on voicechat:8787. Also add core's makeBridge/proxy.ts:
   production traffic entering directly on port 8787 must still reach Make.
3. ☑ Verify embedded mode and two-process remote mode on a local production-data
   copy, including the panel through core's proxy. The full local Compose build
   was not run at this stage because Whisper/Playwright images were expensive;
   the historical round checked make-runtime in production instead.
4. ☑ Update deploy, server-internals, architecture, UI, package instructions, and
   the session journal.

### Round 4 — independent releases (original follow-up checklist)

The original remaining work below was subsequently continued in
[application-independent-releases.md](application-independent-releases.md).
These checkboxes preserve the state of this extraction plan.

1. ☐ Add a Release Center flow for building and replacing one service; the
   initial idea used `docker compose up -d --build make` instead of the full
   release flow. The later implementation installs immutable prepared artifacts.
2. ☐ Show Make's version in health and administration alongside core's version.
3. ☐ Deferred: Make-owned SSE, a separate UI entry point, and assistant API keys.
   The UI entry point was later implemented in `packages/make-app`.

## Risks and decisions

- **Two HTTP hops per authenticated request:** read authorization caching removes
  the repeated whoami hop. Conversation/project lookups are occasional; files,
  previews, and snapshots remain local to Make.
- **Internal API exposure:** internal endpoints require Bearer authentication
  and are hidden by Caddy; they are not listed as public core routes.
- **Session revocation:** cached reads have a window of at most 30 seconds.
  An explicit session-revoked callback can be added if required.
- **Event ordering:** remote make.changed may arrive after the REST response.
  The panel processes revision changes monotonically; round 2 verifies this.
- **Desktop:** embedded mode preserves the existing integration.
