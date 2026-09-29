#!/usr/bin/env python3
"""Plan conservative Core release retention for the installed deploy launcher."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

RELEASE = re.compile(r"^(\d+)\.(\d+)\.(\d+)-([0-9a-f]{8,40})$")
LOCAL_CORE_IMAGE = re.compile(r"^sislexa-(?:s3-)?core:(.+)$")
TERMINAL_OPERATIONS = {"succeeded", "failed", "recovered"}


def configured_repository(path: pathlib.Path) -> str | None:
    if not path.is_file():
        return None
    for line in path.read_text().splitlines():
        if line.startswith("VC_REPO_DIR="):
            value = line.partition("=")[2].strip().strip("\"'")
            if pathlib.Path(value).is_absolute():
                return value
            raise ValueError("production VC_REPO_DIR must be absolute")
    raise ValueError("production VC_REPO_DIR is missing")


def release_ancestor(root: pathlib.Path, value: str) -> pathlib.Path | None:
    if not value:
        return None
    path = pathlib.Path(value)
    if not path.is_absolute():
        return None
    path = path.resolve()
    for candidate in (path, *path.parents):
        if candidate.parent == root:
            return candidate
    return None


def plan(
    root: pathlib.Path,
    keep: int,
    protected_paths: list[str],
    operations: pathlib.Path,
    image_tags: list[str],
) -> list[dict[str, object]]:
    if keep < 1:
        raise ValueError("retention must be positive")
    if root.is_symlink() or not root.is_dir() or root.resolve() != root:
        raise ValueError("release root must be a canonical directory")
    releases = []
    for entry in root.iterdir():
        match = RELEASE.fullmatch(entry.name)
        if match and entry.is_dir() and not entry.is_symlink():
            releases.append((tuple(int(match.group(i)) for i in (1, 2, 3)), entry))
    releases.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    protected = {
        ancestor for value in protected_paths
        if (ancestor := release_ancestor(root, value)) is not None
    }
    if operations.is_dir():
        for record in operations.glob("*.json"):
            data = json.loads(record.read_text())
            if data.get("state") not in TERMINAL_OPERATIONS:
                repository = data.get("request", {}).get("repository")
                if not isinstance(repository, str):
                    raise ValueError(f"invalid operation repository: {record.name}")
                ancestor = release_ancestor(root, repository)
                if ancestor is not None:
                    protected.add(ancestor)
    selected = []
    for _, entry in releases[keep:]:
        if entry in protected:
            continue
        match = RELEASE.fullmatch(entry.name)
        assert match is not None
        version = ".".join(match.group(i) for i in (1, 2, 3))
        prefix = match.group(4)
        images = []
        for tag in image_tags:
            local = LOCAL_CORE_IMAGE.fullmatch(tag)
            if local and re.fullmatch(re.escape(version) + "-" + re.escape(prefix) + r"[0-9a-f]{0,32}", local.group(1)):
                images.append(tag)
        selected.append({"directory": entry.name, "images": sorted(set(images))})
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=pathlib.Path, required=True)
    parser.add_argument("--keep", type=int, required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--production-env", type=pathlib.Path, required=True)
    parser.add_argument("--operations", type=pathlib.Path, required=True)
    parser.add_argument("--rollback", default="")
    parser.add_argument("--compose-file", default="")
    args = parser.parse_args()
    protected = [args.current, args.rollback, configured_repository(args.production_env) or ""]
    protected.extend(args.compose_file.split(":"))
    image_tags = [line.strip() for line in sys.stdin if line.strip()]
    print(json.dumps(plan(args.root, args.keep, protected, args.operations, image_tags)))


if __name__ == "__main__":
    main()
