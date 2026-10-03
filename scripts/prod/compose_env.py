#!/usr/bin/env python3
"""Read checkout Compose settings without sourcing or interpolating shell code."""

import argparse
import os
from pathlib import Path
import re
import sys
from typing import Dict


def read_env(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    values = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if not match:
            raise ValueError(f"{path}:{number}: invalid assignment")
        key, value = match.groups()
        if value.startswith(("'", '"')):
            quoted = re.fullmatch(r"(['\"])(.*?)\1\s*(?:#.*)?", value)
            if not quoted:
                raise ValueError(f"{path}:{number}: invalid quoted value")
            value = quoted.group(2)
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        values[key] = value
    return values


def chain(path: Path) -> str:
    value = os.environ.get("COMPOSE_FILE") or read_env(path).get("COMPOSE_FILE")
    if value:
        return value
    # Retain the existing Compose default-name discovery order.
    for name in ("compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"):
        if Path(name).is_file():
            stem = name.rsplit(".", 1)[0]
            overrides = [f"{stem}.override.{ext}" for ext in ("yaml", "yml")
                         if Path(f"{stem}.override.{ext}").is_file()]
            return ":".join([name] + overrides[:1])
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    get = commands.add_parser("get")
    get.add_argument("key")
    get.add_argument("--file", type=Path, default=Path(".env"))
    command = commands.add_parser("chain")
    command.add_argument("--file", type=Path, default=Path(".env"))
    args = parser.parse_args()
    try:
        print(read_env(args.file).get(args.key, "") if args.command == "get" else chain(args.file))
    except (ValueError, OSError) as error:
        print(error, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
