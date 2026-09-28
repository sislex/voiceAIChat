"""Pin existing non-Core services to verified local Docker image references."""

import json
import re
import subprocess
import sys


IMAGE_ID = re.compile(r"sha256:[a-f0-9]{64}\Z")
SERVICE_NAME = re.compile(r"[a-z][a-z0-9-]*\Z")


def render_local_image_pins(services, running_image):
    if not isinstance(services, dict) or "voicechat" not in services:
        raise ValueError("Core service is missing from Compose")
    lines = ["services:"]
    for name in sorted(services):
        if name == "voicechat":
            continue
        if not SERVICE_NAME.fullmatch(name):
            raise ValueError("Invalid Compose service name")
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
        config = json.load(sys.stdin)
        sys.stdout.write(render_local_image_pins(config["services"], current_image))
    except (KeyError, ValueError, subprocess.CalledProcessError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from None
