#!/usr/bin/env python3
"""Hold the existing Core/UI deployment flock across the entire adapter process."""
import fcntl
import json
import os
import sys

if len(sys.argv) != 5 or sys.argv[1] not in ('deploy', 'reconcile'):
    sys.exit('Usage: delivery-release-lock.py deploy|reconcile INPUT CONFIG NODE')
with open(sys.argv[3], encoding='utf8') as source:
    config = json.load(source)
lock_path = config['hostLock']
if not os.path.isabs(lock_path):
    sys.exit('hostLock must be absolute and match VC_DEPLOY_LOCK')
lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit('Another Core/UI deployment owns the host lock')
os.set_inheritable(lock_fd, True)
environment = dict(os.environ, SISLEXA_RELEASE_LOCK_FD=str(lock_fd))
script = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'delivery-release.mjs')
os.execve(os.path.realpath(sys.argv[4]), [sys.argv[4], '--import', 'tsx', script, *sys.argv[1:4]], environment)
