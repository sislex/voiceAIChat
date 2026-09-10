# Make and real project components: preview, edit, and prepare a merge ticket

Original objective: extend Make beyond its workshop at
`<dataDir>/make/<conversationId>` and small story runner. Users should be able to
open components from a real repository working copy on a machine, preview them
in the project's actual Storybook, edit a file, and create a ticket ready for
merging through kanban.

Decisions agreed with the user:

- Source code comes from the **machine working copy** through `projects:git*`
  and `GitWorkspaceService`, without copying it into the workshop.
- Preview uses the **machine's Storybook dev server**, typically started with
  `npm run storybook`, through the existing same-origin proxy:
  `/api/preview?url=http://<agentId>.machine.internal:<port>/...`.
- A ticket includes a task, branch, commit, push, a `ci_workspaces(pushed=1)`
  record, and placement in `awaiting_merge`. The normal merge-run action then
  merges it into main.

## Existing building blocks

The paths below record the original implementation plan; Make UI and Reader
implementations have since moved into their own application packages.

| Building block | Location |
|---|---|
| Working copies, Git operations, permissions, locks, and audit | `apps/server/src/git/workspaceService.ts` (`resolve/file/saveFile/createBranch/commit/push`) and `apps/server/src/git/scripts.ts` |
| Repository file bridge channels | `projects:gitTree`, `projects:gitFile`, `projects:gitSaveFile`, `projects:gitStatus`, `projects:gitGrep` in `packages/shared/src/ipc.ts` |
| Machine-port HTTP bridge and same-origin iframe | Preview proxy using `<agentId>.machine.internal`, with `session:ensurePreview` cookies |
| Live process with logs and stop support | PTY sessions through `AgentRegistry.ptyStart/ptyInput/ptyKill/ptyBufferText/ptyLive` |
| Port readiness probe | `AgentRegistry.http(agentId, {method,port,path})` |
| Editor and diff | Shared `CodeEditor.tsx` and `CodeDiff.tsx` |
| Task creation and merge | `db.createTask`, `db.moveTask`, `db.createCiWorkspace`, and `POST /api/projects/:id/tasks/:taskId/merge` |

## Implementation stages

1. **Contract:** `packages/shared/src/projectComponents.ts` defines
   `ProjectComponentEntry`, `ProjectStorybookSession`,
   `PROJECT_STORYBOOK_DEFAULT_PORT`, `storybookStoryId`, and
   `projectStorybookFrameUrl`; add `projects:components*` channels to `ipc.ts`
   and paths to `protocol.ts`.
2. **Server:** `apps/server/src/components/storybookSessions.ts` manages PTY
   sessions, starts in the working-copy directory, probes `/index.json`, exposes
   logs, and stops processes. Routes in
   `apps/server/src/routes/projectComponents.ts` include `GET .../components`,
   `GET|POST .../components/storybook`, and `POST .../components/ticket`.
   Prefer live `/index.json` for actual story IDs; otherwise use
   `GitWorkspaceService.storyFiles` to run `git ls-files '*.stories.*'`.
3. **Preview UI:** Make's Project tab uses `MakeProjectComponents` for
   working-copy selection, component lists, Storybook start/stop, status and
   logs, and the story iframe.
4. **Editing UI:** use `CodeEditor` with `projects:gitFile` and
   `projects:gitSaveFile`. Reload the frame after saving because the proxy does
   not carry HMR WebSockets.
5. **Merge ticket:** the edit-to-task dialog creates an `awaiting_merge` task,
   a branch using `ci_branch_template`, a commit of selected paths, and a push.
   Record `ci_workspaces(pushed=1)`, then return the working copy to its base
   branch.
6. **KB and gate:** update `docs/kb/ui.md`, `docs/kb/projects.md`, and the session
   journal; run `npm run gate`.

## Constraints surfaced in the interface

- Storybook uses a PTY session and can stop because of `ptyIdleMinutes` or an
  offline machine.
- The proxy does not forward WebSockets, so saving reloads the frame instead of
  relying on HMR.
- At the time of this plan, proxy responses were limited to 5 MiB with 10/15-second
  timeouts; probing `/index.json` warms the first load.
- The edit-to-ticket shortcut intentionally skips preparation, CI, and QA for
  small edits. The merge run still requires its own tests, KB checks, and
  conflict handling.
