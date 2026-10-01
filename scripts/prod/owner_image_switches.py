"""Owner images a release itself moved: switch only those, keep everything else on running images.

The release-manager deploy pins every non-Core service to its running image so a Core release
never rebuilds or pulls an owner service by accident (local_image_pins.py). A composed release
(Release Center «Приложения») moves an owner image in the repository compose on purpose; that
service must start the new image. A service switches only when the release changed its default
`${SISLEXA_*_IMAGE:-ghcr.io/sislex/…:<commit>}` against the production commit, the new reference
is immutable, and the operator does not override that variable in the environment.
"""

import json
import os
import re
import subprocess
import sys

SERVICE = re.compile(r"^  ([a-z][a-z0-9-]*):\s*$")
IMAGE = re.compile(r"^\s+image:\s*\$\{(SISLEXA_[A-Z0-9_]+_IMAGE):-([^}\s]+)\}\s*$")
IMMUTABLE = re.compile(r"ghcr\.io/sislex/[a-z0-9._-]+(?::[a-f0-9]{40}|@sha256:[a-f0-9]{64})\Z")
COMMIT = re.compile(r"[a-f0-9]{7,40}\Z")


def compose_pins(text):
    """{service: (variable, default reference)} for `image: ${VAR:-ref}` lines of one compose file."""
    pins, service = {}, None
    for line in text.splitlines():
        match = SERVICE.match(line)
        if match:
            service = match.group(1)
            continue
        match = IMAGE.match(line)
        if match and service:
            pins[service] = match.groups()
    return pins


def owner_image_switches(old_texts, new_texts, env):
    """Services whose immutable owner image the release changed; operator variables win."""
    old, new = {}, {}
    for text in old_texts:
        old.update(compose_pins(text))
    for text in new_texts:
        new.update(compose_pins(text))
    switches = {}
    for service, (variable, reference) in sorted(new.items()):
        if service not in old or old[service][1] == reference:
            continue
        if not IMMUTABLE.fullmatch(reference) or env.get(variable):
            continue
        switches[service] = reference
    return switches


def compose_files(root):
    files = ["docker-compose.yml"]
    deploy = os.path.join(root, "deploy")
    if os.path.isdir(deploy):
        files += sorted(f"deploy/{name}" for name in os.listdir(deploy) if re.fullmatch(r"compose\.[\w.-]+\.yml", name))
    return [path for path in files if os.path.isfile(os.path.join(root, path))]


def previous_commit():
    """Production commit from the running Core container; unknown means no switches."""
    container = subprocess.run(["docker", "compose", "ps", "-q", "voicechat"], capture_output=True, text=True).stdout.strip()
    if not container:
        return None
    env = subprocess.run(["docker", "inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", container], capture_output=True, text=True).stdout
    value = next((line.split("=", 1)[1] for line in env.splitlines() if line.startswith("VC_RELEASE_COMMIT=")), "")
    if not COMMIT.fullmatch(value):
        return None
    resolved = subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{value}^{{commit}}"], capture_output=True, text=True)
    return resolved.stdout.strip() or None


def main(root="."):
    previous = previous_commit()
    if not previous:
        print("{}")
        return
    files = compose_files(root)
    new_texts = [open(os.path.join(root, path), encoding="utf-8").read() for path in files]
    old_texts = []
    for path in files:
        shown = subprocess.run(["git", "show", f"{previous}:{path}"], capture_output=True, text=True)
        if shown.returncode == 0:
            old_texts.append(shown.stdout)
    print(json.dumps(owner_image_switches(old_texts, new_texts, os.environ), sort_keys=True))


if __name__ == "__main__":
    main()
