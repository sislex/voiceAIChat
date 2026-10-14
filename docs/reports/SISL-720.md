# SISL-720 vendor archive audit

Baseline: `2b094a67a442be8f0e9edf0a50db63c064b0e884`.

The baseline contains 76 vendor archives. Complete source analysis identified
47 unused archives totaling **125,372,643 bytes (119.565 MiB)** and retained 29.
The initial 78/25/53 counts were estimates; actual retained consumers include
both owner and snapshot Shared pins and the UI-library inventory used by release
publication. No pinned version, archive content, inventory or lockfile changed.

- `SISL-720-vendor-inventory.json`: complete pre-cleanup archive sizes and source map.
- `SISL-720-vendor-removed.json`: every deletion and its size.
- `node scripts/vendor-archives.mjs --report`: current reference map.
- `node --test scripts/vendor-install.test.mjs`: clean-clone npm ci, exact lockfile
  comparison, and byte totals from `git ls-tree -r -l` for the baseline and HEAD.
  `VENDOR_TARGET_COMMIT` can select an immutable validation snapshot.

The total Git tree reduction is slightly smaller than the deleted archive bytes
because this change adds the analyzer, regression tests, reference map and reports.
The test prints exact before/after totals and commit IDs; this measures the
current file tree, not historical Git storage or network transfer.

Archive analysis is shared by the tree test and all three pin writers:
`pin-shared-chat.mjs`, `contracts-release.mjs` and `release-composition.mjs`.
It includes tracked and untracked non-ignored repository package manifests and
lockfiles, script literals, and the `asset` fields consumed from owner, snapshot
and UI inventories. Generated dependencies are not repository sources. Read,
parse and symlink failures stop cleanup. A successful pin rechecks references
after all updates and only sweeps archives that existed before the operation.

Coverage markers TC-01/TC-02/TC-03 are in the tooling tests; TC-04/TC-05 are in
the explicit integration suite. TC-09 marks the existing Core readiness gate's
UI/coverage regressions, not the absent owner runtime schema.

The preparation prompt/parser and their format/normalization tests have moved
out of Core to `sislexa-kanban`. Therefore TC-07, TC-08 and the runtime-schema
portion of TC-09 remain owner work; this change does not fabricate a duplicate
unused parser or claim those acceptance criteria are complete.
