# Knowledge base: one writer of topics

Plan ID: `kb-single-writer-v1`

Created: 2026-09-29

Baseline: Core `origin/main` at `dcb4f85b`

Repository: Core (`sislex/voiceAIChat`) only.

## Start here

This plan reuses the delivery control system and handoff format of
[`shared-chat-distributed-delivery.md`](shared-chat-distributed-delivery.md)
sections 2–3 and 6. Execution profiles must declare the base SHA, allowed paths,
trusted `npm ci`, `STORYBOOK_DISABLE_TELEMETRY=1` and the owner `gate`. Gates that
run nested `npm` must not run inside the macOS task boundary.

Tasks of this plan run in parallel in one repository. Each task owns the files listed
in its row; a task that must touch another task's file records it in its result.
While this plan is in progress, tasks edit topics the current way; the new rule
applies after C01 is released.

## 1. Problem

Branches edit the same KB topics during development. `kb:touch` rewrites the shared
`updated:`/`checked:` lines, so independent branches conflict. The merge runner
normalizes these lines line by line, which also rewrites `checked:` inside code
examples (`docs/kb/features/merge-runner.md`). Whole-file `checkout --ours` already
lost 18 lines once (`docs/kb/kb-workflow.md`). Merges also happen outside the kanban
merge runner: delivery-control and GitHub pull requests. A fix bound to the kanban
merge runner would not cover them.

## 2. Outcome

- Task branches never edit topics (`docs/kb/*.md`, `docs/kb/features/*.md`, other
  non-journal KB files). They add journal entries only. Journal file names are unique
  per date, machine and slug, so branches cannot conflict in the KB.
- One server job, the KB fold job, is the only writer of topics. It runs on `main`
  after every change of `main`, whatever merged it, and folds pending journal entries
  into topics.
- Search and context show a topic together with its pending entries, so the KB is
  never stale for readers between a merge and the fold.
- No fold silently deletes topic text.

## 3. Journal entry contract

A new entry created by `kb:log` has these front matter fields in addition to
`title`, `date`, `machine`, `author`:

- `kb-fold: pending` — the entry has facts for topics. After folding, the job sets
  `kb-fold: <main SHA>` and `kb-folded-into: [<topic path>#<heading>, …]`, or
  `kb-fold: skipped` with `kb-fold-reason: <text>`.
- `kb-topics: [<topic path>, …]` — target topics proposed by the author; the fold job
  may choose others and records the actual targets.

The body section `## Факты для базы знаний` lists facts as bullet points, each
optionally prefixed with `<topic path>#<heading>:`. Entries without `kb-fold` are
legacy history and are never folded. The contract is part of B02 and documented in
`docs/kb/kb-workflow.md`.

## 4. Fold job

- Trigger: success of a kanban merge run, and a detected new `main` commit from any
  other path (periodic fetch of `origin/main` for enabled projects).
- Enablement: only projects whose repository contains `docs/kb/log/` and whose
  project setting enables the fold job. Other projects on production are unaffected.
- Exclusion: the job takes the same process-global slot as merge runs, so it never
  overlaps a merge run.
- Work: in a detached worktree of the fetched `main`, collect entries with
  `kb-fold: pending`; run the existing KB model hook (`ci/modelHooks.ts`,
  `kb/codeUpdate.ts`) with those entries as input; require a structured response with
  a decision for every entry and an explicit list of removed topic lines.
- Deterministic tail: set `updated`/`checked` only in the front matter of changed
  topics, mark entries, regenerate the index, run `kb.mjs check`.
- Deletion guard: every removed line of a topic must be in the declared list;
  otherwise the job stops without push and reports the lines.
- Publication: one `docs(kb): fold journal <short SHA>` commit pushed to `main` with
  `--force-with-lease` on the fetched SHA. If `main` moved, repeat from the new `main`.
  No other writer of topics exists, so a repeat cannot conflict.
- Limits: at most 20 entries per fold; the rest go to the next fold. Model and time
  budgets reuse the merge-run KB step limits.
- Visibility: fold runs, their entries, decisions and failures are shown in the
  project merge feed.

## 5. Stages and task backlog

### S0 — Parallel foundations

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| B01 | Core | — | Transition fix: merge-runner KB conflict normalization and `kb.mjs touch` change `updated:`/`checked:` only inside YAML front matter; tests with two independent edits of one topic and a `checked:` line inside a code block, both preserved after merge. Owns `apps/server/src/merge/**` and the `touch` command of `scripts/kb.mjs` |
| B02 | Core | — | Journal contract of section 3 in `kb:log`; `kb.mjs check` accepts a pending entry naming a topic as its update; a dev-gate rule rejects topic edits relative to the merge base with a hint to `kb:log`, behind a project flag; `kb-search` `context` and `search` return pending entries with their topics; instructions in `AGENTS.md`, `docs/kb/kb-workflow.md`, `.claude/commands/kb-update.md` and the development KB prompt; tests. Owns `scripts/kb-search.mjs`, `scripts/kb.mjs` except `touch`, and the instruction files |

### S1 — Fold job

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| C01 | Core | B01, B02 | Fold job of section 4: triggers, per-project enablement, shared merge slot, model step with per-entry decisions, front matter metadata, deletion guard, lease push with repeat on moved main, merge feed visibility; merge runner KB model step reduced to index regeneration for enabled projects; unit and integration tests for every rule including a moved main, a missing decision and an undeclared deletion |

### S2 — End-to-end verification

| ID | Owner | Depends on | Deliverable and acceptance |
| --- | --- | --- | --- |
| U01 | Core | C01 | System test: two parallel branches add facts for the same topic section through journal entries; one merges through the kanban merge runner, the other through a plain push to main; the fold job folds both without Git conflicts and without lost lines; legacy entries stay untouched; a disabled project keeps the old behavior; KB feature page `docs/kb/features/kb-fold.md` |

**Release and acceptance.** Release Core with the fold job disabled, enable it for
the ChatAI project, merge two parallel tasks touching the same topic and verify the
fold commit, the entry marks and the merge feed. The owner decides the evidence level.

## 6. Parallelism and duration

| Task | Estimate | Runs in parallel with |
| --- | --- | --- |
| B01 | 0.5–1 day | B02 |
| B02 | 1 day | B01 |
| C01 | 2–3 days | — |
| U01 | 0.5–1 day | — |

Critical path B02 → C01 → U01 is 3.5–5 days. As one sequential task the same work is
4.5–6 days. Parallel work saves about a day and ships B01, the immediate relief for
current conflicts, first. Splitting C01 further does not shorten the path: the job,
its guard and its publication share one module and one test suite.
