# Current workstation route baseline

Measured on 2026-09-21 from the clean `origin/main` commit
`1b82ffaa32f6311617182b69945e052c60be757f` in an independent worktree, with its
own root and Electron dependency installations and production builds. No source
files or measurement conditions were edited in that worktree.

Node is 22.19.0. The actual Electron viewport is 1440 by 872 at scale factor 2;
the older workstation baseline was clamped to 1280 by 774. The Linux baseline
also uses a different Node/zlib runtime and scale factor. Neither is a valid
comparison for this workstation configuration.

Both the clean baseline and the accounting branch pass the unchanged absolute
route budgets. All 96 route/type/compression comparisons have zero size delta.
The complete measured artifact is retained, including clean commit provenance,
actual viewports, runtime/tool versions, resource hashes and activation results.
The gate selects it by the same strict condition comparison as other baselines.
