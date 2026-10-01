"""What the environment checkout actually runs: service → image, image ID, commit, health.

Runs in the environment's compose checkout (the agent executes it there, like a release deploy)
and changes nothing. Kanban maps images to module releases (docs/plans/environments.md):
`ghcr.io/sislex/<image>:<40-hex commit>` is a published owner image; anything else is a local
build that environments-v1 shows but does not switch.
"""

import json
import os
import re
import subprocess
import sys

COMMIT = re.compile(r"[a-f0-9]{40}\Z")
OWNER_IMAGE = re.compile(r"ghcr\.io/sislex/[a-z0-9._-]+")
DOCKER = os.environ.get("DOCKER", "docker")


def owner_reference(references):
    """The published owner image among references (`ghcr.io/sislex/<image>:<commit>`), if any."""
    for reference in references:
        name, _, tag = reference.rpartition(":") if ":" in reference.split("/")[-1] else (reference, "", "")
        if OWNER_IMAGE.fullmatch(name) and COMMIT.fullmatch(tag):
            return reference, tag
    return None, None


def describe_container(inspected, image_tags=()):
    """One ObservedService from `docker inspect` of a compose container.

    A container started by image ID (operator pins `sha256:…`) still runs a published owner
    image when that ID is tagged `ghcr.io/sislex/<image>:<commit>`; the tags tell which one.
    """
    labels = inspected.get("Config", {}).get("Labels") or {}
    image = inspected.get("Config", {}).get("Image") or ""
    reference, tag = owner_reference([image, *image_tags])
    owner = reference is not None
    health = (inspected.get("State", {}).get("Health") or {}).get("Status")
    return {
        "service": labels.get("com.docker.compose.service", ""),
        "image": image,
        "imageId": inspected.get("Image", ""),
        "commit": tag if owner else None,
        "local": not owner,
        "healthy": None if health is None else health == "healthy",
    }


def core_release(inspected):
    env = dict(line.split("=", 1) for line in inspected.get("Config", {}).get("Env") or [] if "=" in line)
    return {"version": env.get("VC_RELEASE_VERSION") or None, "commit": env.get("VC_RELEASE_COMMIT") or None}


def observe(inspected_containers, tags_by_image=None):
    services, core = [], {"version": None, "commit": None}
    for inspected in inspected_containers:
        row = describe_container(inspected, (tags_by_image or {}).get(inspected.get("Image", ""), ()))
        if not row["service"]:
            continue
        if row["service"] == "voicechat":
            core = core_release(inspected)
            continue
        services.append(row)
    services.sort(key=lambda row: row["service"])
    return {"core": core, "services": services}


def main():
    ids = subprocess.run([DOCKER, "compose", "ps", "-a", "-q"], capture_output=True, text=True, check=True).stdout.split()
    inspected = json.loads(subprocess.run([DOCKER, "inspect", *ids], capture_output=True, text=True, check=True).stdout) if ids else []
    images = sorted({row.get("Image", "") for row in inspected if row.get("Image")})
    described = json.loads(subprocess.run([DOCKER, "image", "inspect", *images], capture_output=True, text=True, check=True).stdout) if images else []
    tags = {image.get("Id", ""): image.get("RepoTags") or [] for image in described}
    print(json.dumps(observe(inspected, tags), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, ValueError) as error:
        print(f"environment observation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
