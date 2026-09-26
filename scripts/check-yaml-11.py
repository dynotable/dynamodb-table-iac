#!/usr/bin/env python3
"""YAML 1.1 parity check for the CloudFormation goldens.

cfn-lint (and CloudFormation itself) read YAML with PyYAML, a YAML 1.1 parser:
an unquoted `Yes` is a boolean, an unquoted `2010-09-09` a date, a raw U+0085
inside a double-quoted scalar a line break. The `yaml` npm package the unit
tests use is YAML 1.2 and cannot see any of that, so this script parses every
golden with PyYAML and requires it to equal the JSON the emitter produced for
the same fixture.

Usage: check-yaml-11.py <golden-dir> <json-dir>
  <json-dir> holds <fixture>.json for every <fixture>.yaml, written by
  scripts/render-cfn-json.mjs.

The control case runs first: it proves PyYAML would turn an UNQUOTED `Yes:`
key into a boolean, so a golden that stopped quoting it would fail here.
"""
import json
import sys
from pathlib import Path

import yaml

CONTROL = "Yes: 1\nNo: off\n"


def main(golden_dir: str, json_dir: str) -> int:
    control = yaml.safe_load(CONTROL)
    if control != {True: 1, False: False}:
        print(f"control case did not behave as YAML 1.1: {control!r}", file=sys.stderr)
        return 2

    failures = 0
    for golden in sorted(Path(golden_dir).glob("*.yaml")):
        expected_path = Path(json_dir) / (golden.stem + ".json")
        if not expected_path.exists():
            print(f"{golden.name}: no {expected_path.name} to compare against", file=sys.stderr)
            failures += 1
            continue
        parsed = yaml.safe_load(golden.read_text(encoding="utf-8"))
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        if parsed != expected:
            print(f"{golden.name}: PyYAML reads a different document than the JSON form", file=sys.stderr)
            failures += 1
        else:
            print(f"{golden.name}: ok")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
