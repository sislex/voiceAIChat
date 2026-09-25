#!/usr/bin/env python3
"""Freeze a deploy script and its optional companion before executing either."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile

NAMES = ('deploy.sh', 'source-recovery.py')


def fail(message):
    raise ValueError(message)


def read_source(path):
    # O_NONBLOCK prevents a substituted FIFO from hanging the root launcher.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            fail('source is not a regular file')
        data = stream.read()
        after = os.fstat(stream.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            fail('source changed while selecting runtime')
        # Keep script/executable permissions, never special or group/other write bits.
        mode = stat.S_IMODE(before.st_mode) & 0o755
        return data, mode


def snapshot(source):
    pair = {}
    for name in NAMES:
        try:
            pair[name] = read_source(source / name)
        except FileNotFoundError:
            if name == 'deploy.sh':
                raise
            pair[name] = None
    if not pair['deploy.sh'][1] & 0o100:
        fail('deploy.sh must be executable')
    return pair


def identity(pair):
    entries = {name: None if value is None else {
        'sha256': hashlib.sha256(value[0]).hexdigest(), 'mode': value[1],
        'size': len(value[0])} for name, value in pair.items()}
    manifest = json.dumps({'schemaVersion': 1, 'files': entries},
                          sort_keys=True, separators=(',', ':')).encode() + b'\n'
    return hashlib.sha256(manifest).hexdigest(), manifest


def trusted_directory(path):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, os.geteuid())
            or info.st_mode & 0o022):
        fail('runtime directory is symlink, foreign-owned or writable by group/others')


def verify(runtime, pair, manifest):
    trusted_directory(runtime)
    expected = {name for name, value in pair.items() if value is not None} | {'manifest.json'}
    if set(os.listdir(runtime)) != expected:
        fail('runtime is partial or has unexpected entries')
    values = {**pair, 'manifest.json': (manifest, 0o444)}
    for name in expected:
        path = runtime / name
        info = path.lstat()
        data, mode = values[name]
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != mode):
            fail('runtime file has unsafe type, owner, links or mode')
        copied, copied_mode = read_source(path)
        if copied_mode != mode or hashlib.sha256(copied).digest() != hashlib.sha256(data).digest():
            fail('runtime copied hash mismatch')


def pin(source, root, required):
    # The store and its ancestors must not redirect into attacker-controlled paths.
    if not root.is_absolute() or root.resolve() != root:
        fail('runtime store must be an absolute canonical path')
    for directory in (root, *root.parents):
        trusted_directory(directory)
    pair = snapshot(source)
    if required and pair['source-recovery.py'] is None:
        fail('required companion source-recovery.py is absent; deployment not launched')
    digest, manifest = identity(pair)
    runtime = root / ('source-' + digest)
    # This short directory flock serializes publication only. It is released before
    # exec and never participates in the Core/UI host deployment lock.
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        if os.path.lexists(runtime):
            verify(runtime, pair, manifest)
        else:
            temporary = Path(tempfile.mkdtemp(prefix='.source-', dir=root))
            try:
                for name, value in {**pair, 'manifest.json': (manifest, 0o444)}.items():
                    if value is None:
                        continue
                    data, mode = value
                    target = temporary / name
                    with target.open('xb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fchmod(stream.fileno(), mode)
                        os.fsync(stream.fileno())
                verify(temporary, pair, manifest)
                # Reject source movement, including helper appearance/disappearance.
                if snapshot(source) != pair:
                    fail('source changed while copying runtime')
                os.chmod(temporary, 0o755)
                directory = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
                # All publishers hold the store flock; an existing runtime is
                # validated above, never repaired or overwritten (even if empty).
                os.rename(temporary, runtime)
                os.fsync(fd)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        verify(runtime, pair, manifest)
    finally:
        os.close(fd)
    return runtime / 'deploy.sh'


def main():
    source, root, *arguments = sys.argv[1:]
    required = os.environ.get('VC_SOURCE_RECOVERY_REQUIRED', '0')
    if required not in ('0', '1'):
        fail('VC_SOURCE_RECOVERY_REQUIRED must be 0 or 1')
    # The v2 owner protocol always requires the adjacent recovery implementation.
    needs_companion = required == '1' or arguments[:1] == ['--source-request']
    runtime = pin(Path(source), Path(root), needs_companion)
    os.execv(str(runtime), [str(runtime), *arguments])


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print('source runtime rejected: ' + str(error), file=sys.stderr)
        sys.exit(78)
