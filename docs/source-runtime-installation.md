# Paired source launcher installation

`scripts/prod/install.sh` installs a stable `voicechat-deploy` wrapper and the
small standard-library Python publisher `source-runtime.py`. The publisher is
installation machinery, not the recovery implementation. It snapshots the selected
checkout's `scripts/prod/deploy.sh` and optional adjacent `source-recovery.py`
before executing the frozen `deploy.sh`. No recovery placeholder is installed.

Each runtime is `/usr/local/lib/voicechat/source-<sha256>/`. The digest binds a
canonical versioned manifest containing both filenames, their byte hashes,
lengths and sanitized script modes, including an explicit null for an absent
companion. Empty and absent companions differ. Both files keep their exact bytes
and adjacency; executable bits are retained, while special bits and group/other
write permissions are removed. `deploy.sh` must be owner-executable.

Publication uses a private temporary directory in the store, exclusive file
creation, verified copied hashes, a second source snapshot, file/directory fsync
and atomic directory rename. A short flock on the store directory serializes
publication and validation. It is closed before execution, has no lockfile and
does not replace or compete with `/var/lock/voicechat-deploy.lock`. Concurrent
publishers reuse only a fully verified runtime. A symlink, unsafe owner/mode,
unexpected entry, hard-linked file, partial directory or hash mismatch fails
closed with exit 78. Existing runtimes are never repaired or overwritten.
Private staging directories abandoned by a killed publisher are never selected.

The store must already exist, be canonical and have trusted owners and no
group/other write permissions throughout its ancestry. In a root installation,
published files are root-owned. These checks protect against unprivileged
replacement; a privileged administrator can still modify root-owned files.
Do not mutate or garbage-collect a runtime used by a running operation. This
change deliberately adds no automatic runtime cleanup.

The wrapper preserves argv, the repository environment and the existing explicit
`VC_RELEASE_VERSION` / `VC_RELEASE_VERSION_SOURCE` boundary. Existing detachment
re-executes the selected runtime's `$0`, so later checkout changes cannot replace
either selected file. Manual source deployment and the UI wrapper are unchanged.
Publication is not an operation journal and adds no new deployment protocol.

Historical checkouts without `source-recovery.py` still launch normally. A v2
`--source-request` invocation always requires the companion before launch.
Other callers can additionally require it with `VC_SOURCE_RECOVERY_REQUIRED=1`.
Absence fails even when a legacy runtime already exists. The environment default
is `0`; values other than `0` and `1` are rejected. Installing this launcher alone
does not commission recovery or validate a release request.

Run `node --test scripts/source-runtime-installation.test.mjs` for isolated
actual-process coverage. Tests extract the generated wrapper, rewrite only its
installation paths into disposable directories and use harmless fixture scripts.
They never execute `install.sh`, real deployment commands, services or data access.
Coverage includes byte identity, changed helpers/modes/absence, required missing
helpers, concurrent publication/replay, tampering and partial/symlink states,
copy corruption and detached stability across checkout updates.

This is B01 implementation evidence within B06, not stage acceptance or operator
commissioning. The supervisor must run the full gate and combined Linux tests.
