#!/usr/bin/env python3
"""Keep the deployment flock held until an in-flight external command exits."""
import fcntl
import os
import subprocess
import sys

lock_fd = int(os.environ['SISLEXA_RELEASE_LOCK_FD'])
os.fstat(lock_fd)
fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
# Inherit the same open file description, not a newly opened lock file. Both this
# monitor and its command survive adapter death with the deployment lock held.
try:
    result = subprocess.run(sys.argv[1:], pass_fds=(lock_fd,), timeout=120)
    sys.exit(result.returncode if result.returncode >= 0 else 1)
except subprocess.TimeoutExpired:
    sys.exit(124)
