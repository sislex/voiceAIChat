"""Pin existing non-Core services to verified local Docker image references.

A service the release itself moved to a new owner image (owner_image_switches.py) is pinned to
that pre-pulled image instead of its running one; every other service keeps its running image.
"""

import json
import re
import subprocess
import sys


IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
SERVICE_NAME = re.compile(r"[a-z][a-z0-9-]*\Z")


def render_local_image_pins(services, running_image, switches=None, local_image=None):
    if not isinstance(services, dict) or "voicechat" not in services:
        raise ValueError("Core service is missing from Compose")
    lines = ["services:"]
    for name in sorted(services):
        if name == "voicechat":
            continue
        if not SERVICE_NAME.fullmatch(name):
            raise ValueError("Invalid Compose service name")
        if switches and name in switches:
            reference = switches[name]
            image_id = local_image(reference) if local_image else None
        else:
            reference, image_id = running_image(name)
        if (
            not isinstance(reference, str)
            or not reference
            or len(reference) > 300
            or any(char in reference for char in "\n\r\0")
            or not isinstance(image_id, str)
            or not IMAGE_ID.fullmatch(image_id)
        ):
            raise ValueError(f"No verified local image for {name}")
        lines.extend(
            (f"  {name}:", "    build: !reset null", f"    image: {json.dumps(reference)}", "    pull_policy: never")
        )
    return "\n".join(lines) + "\n"


def pulled_image(reference):
    """Local ID of an image the deploy pulled before pinning; missing means the switch is refused."""
    return subprocess.check_output(["docker", "image", "inspect", reference, "--format", "{{.Id}}"], text=True).strip()


def current_image(name):
    container = subprocess.check_output(
        ["docker", "compose", "ps", "-q", name], text=True
    ).strip()
    if not container:
        raise ValueError(f"No running container for {name}")
    image_id = subprocess.check_output(
        ["docker", "inspect", "--format", "{{.Image}}", container], text=True
    ).strip()
    reference = subprocess.check_output(
        ["docker", "inspect", "--format", "{{.Config.Image}}", container], text=True
    ).strip()
    local_id = subprocess.check_output(
        ["docker", "image", "inspect", reference, "--format", "{{.Id}}"], text=True
    ).strip()
    if local_id != image_id:
        raise ValueError(f"Local image changed for {name}")
    return reference, image_id


if __name__ == "__main__":
    try:
        switches = {}
        if "--switches" in sys.argv:
            with open(sys.argv[sys.argv.index("--switches") + 1], encoding="utf-8") as handle:
                switches = json.load(handle)
        config = json.load(sys.stdin)
        sys.stdout.write(render_local_image_pins(config["services"], current_image, switches, pulled_image))
    except (KeyError, ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from None
