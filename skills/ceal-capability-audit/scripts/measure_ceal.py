#!/usr/bin/env python3
"""Run one command while preserving stdout and emitting a cost metric on stderr."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True)
    parser.add_argument(
        "--file-arg",
        action="append",
        default=[],
        metavar="KEY=PATH",
        help="append KEY=<UTF-8 file contents> to the measured command",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    if not args.command:
        parser.error("a command is required after --")
    for file_arg in args.file_arg:
        if "=" not in file_arg:
            parser.error("--file-arg must use KEY=PATH")
        key, path = file_arg.split("=", 1)
        if not key or not path:
            parser.error("--file-arg must use KEY=PATH")
        args.command.append(f"{key}={Path(path).read_text(encoding='utf-8')}")
    return args


def main() -> int:
    args = parse_args()
    started = time.monotonic_ns()
    completed = subprocess.run(args.command, capture_output=True, check=False)
    elapsed_ms = (time.monotonic_ns() - started) / 1_000_000
    stdout_bytes = len(completed.stdout)
    stderr_bytes = len(completed.stderr)
    metric = {
        "label": args.label,
        "command": args.command,
        "exit_code": completed.returncode,
        "local_elapsed_ms": round(elapsed_ms, 3),
        "stdout_bytes": stdout_bytes,
        "stderr_bytes": stderr_bytes,
        "estimated_stdout_tokens": math.ceil(stdout_bytes / 4),
        "token_estimate": "ceil(stdout_bytes / 4), rough size only",
    }
    sys.stdout.buffer.write(completed.stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(
        ("CEAL_AUDIT_METRIC " + json.dumps(metric, ensure_ascii=False, sort_keys=True) + "\n").encode()
    )
    sys.stderr.buffer.write(completed.stderr)
    sys.stderr.buffer.flush()
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
