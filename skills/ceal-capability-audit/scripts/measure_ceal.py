#!/usr/bin/env python3
"""Run one command while preserving stdout and emitting a cost metric on stderr."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import time


DEFAULT_TIMEOUT_SECONDS = 60.0
DEFAULT_MAX_OUTPUT_BYTES = 1_048_576
DEFAULT_MAX_FILE_ARG_BYTES = 262_144


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True, help="stable label for the measured audit command")
    parser.add_argument("--timeout-seconds", type=positive_float, default=DEFAULT_TIMEOUT_SECONDS, help="wall-time deadline for the command")
    parser.add_argument(
        "--max-output-bytes", type=positive_int, default=DEFAULT_MAX_OUTPUT_BYTES, help="maximum captured bytes for each output stream"
    )
    parser.add_argument(
        "--max-file-arg-bytes", type=positive_int, default=DEFAULT_MAX_FILE_ARG_BYTES, help="maximum UTF-8 bytes read from each --file-arg path"
    )
    parser.add_argument(
        "--file-arg",
        action="append",
        default=[],
        metavar="KEY=PATH",
        help="append KEY=<UTF-8 file contents> to the measured command",
    )
    parser.add_argument("command", nargs=argparse.REMAINDER, help="command and arguments to execute after --")
    args = parser.parse_args()
    if args.command[:1] == ["--"]:
        args.command = args.command[1:]
    if not args.command:
        parser.error("a command is required after --")
    total_file_arg_bytes = 0
    for file_arg in args.file_arg:
        if "=" not in file_arg:
            parser.error("--file-arg must use KEY=PATH")
        key, path = file_arg.split("=", 1)
        if not key or not path:
            parser.error("--file-arg must use KEY=PATH")
        try:
            value = read_regular_file_bounded(Path(path), args.max_file_arg_bytes - total_file_arg_bytes)
        except (OSError, argparse.ArgumentTypeError) as error:
            parser.error(str(error))
        total_file_arg_bytes += len(value)
        if total_file_arg_bytes > args.max_file_arg_bytes:
            parser.error("--file-arg exceeds --max-file-arg-bytes")
        try:
            decoded = value.decode("utf-8")
        except UnicodeDecodeError:
            parser.error("--file-arg must contain UTF-8")
        args.command.append(f"{key}={decoded}")
    return args


def positive_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed) or parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive finite number")
    return parsed


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def read_regular_file_bounded(path: Path, remaining: int) -> bytes:
    if remaining < 0:
        raise argparse.ArgumentTypeError("--file-arg exceeds --max-file-arg-bytes")
    flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise argparse.ArgumentTypeError("--file-arg path must be a regular file")
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = -1
            value = stream.read(remaining + 1)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if len(value) > remaining:
        raise argparse.ArgumentTypeError("--file-arg exceeds --max-file-arg-bytes")
    return value


def terminate_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    time.sleep(0.05)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run_bounded(command: list[str], timeout_seconds: float, max_output_bytes: int) -> tuple[int, bytes, bytes, str, int | None]:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    assert process.stdout is not None and process.stderr is not None
    stdout_descriptor = process.stdout.fileno()
    stderr_descriptor = process.stderr.fileno()
    streams = {stdout_descriptor: bytearray(), stderr_descriptor: bytearray()}
    selector = selectors.DefaultSelector()
    for stream in (process.stdout, process.stderr):
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout_seconds
    settlement = "completed"
    while selector.get_map():
        remaining_time = deadline - time.monotonic()
        if remaining_time <= 0:
            settlement = "timeout"
            terminate_group(process)
            break
        for key, _ in selector.select(min(remaining_time, 0.05)):
            descriptor = key.fileobj.fileno()
            try:
                chunk = os.read(descriptor, 65_536)
            except BlockingIOError:
                continue
            if not chunk:
                selector.unregister(key.fileobj)
                key.fileobj.close()
                continue
            sink = streams[descriptor]
            remaining_output = max_output_bytes - len(sink)
            sink.extend(chunk[:remaining_output])
            if len(chunk) > remaining_output:
                settlement = "output_limit"
                terminate_group(process)
                break
        if settlement != "completed":
            break
    selector.close()
    if settlement == "completed" and process.poll() is None:
        remaining_time = deadline - time.monotonic()
        if remaining_time <= 0:
            settlement = "timeout"
            terminate_group(process)
        else:
            try:
                process.wait(timeout=remaining_time)
            except subprocess.TimeoutExpired:
                settlement = "timeout"
                terminate_group(process)
    child_exit = process.returncode
    exit_code = 124 if settlement == "timeout" else 125 if settlement == "output_limit" else int(child_exit or 0)
    return exit_code, bytes(streams[stdout_descriptor]), bytes(streams[stderr_descriptor]), settlement, child_exit


def main() -> int:
    args = parse_args()
    started = time.monotonic_ns()
    exit_code, stdout, stderr, settlement, child_exit = run_bounded(args.command, args.timeout_seconds, args.max_output_bytes)
    elapsed_ms = (time.monotonic_ns() - started) / 1_000_000
    stdout_bytes = len(stdout)
    stderr_bytes = len(stderr)
    metric = {
        "label": args.label,
        "executable": Path(args.command[0]).name,
        "argument_count": len(args.command) - 1,
        "exit_code": exit_code,
        "child_exit_code": child_exit,
        "settlement": settlement,
        "local_elapsed_ms": round(elapsed_ms, 3),
        "stdout_bytes": stdout_bytes,
        "stderr_bytes": stderr_bytes,
        "estimated_stdout_tokens": math.ceil(stdout_bytes / 4),
        "token_estimate": "ceil(stdout_bytes / 4), rough size only",
    }
    sys.stdout.buffer.write(stdout)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(
        ("CEAL_AUDIT_METRIC " + json.dumps(metric, ensure_ascii=False, sort_keys=True) + "\n").encode()
    )
    sys.stderr.buffer.write(stderr)
    sys.stderr.buffer.flush()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
