#!/usr/bin/env python3
"""Worker-owned precision adapter for the Charness duplicate ratchet.

The quality skill owns the ratchet policy and Nose scan. This repository owns the
boundary between that portable detector and the Worker corpus: a family is only
filtered when its evidence proves that Nose grouped distinct large workflows, an
import-only header, or another bounded low-overlap shallow span. The adapter never
changes the baseline and never turns an unreadable scan into an empty inventory.
"""

from __future__ import annotations

import argparse
import json
import re
import runpy
import subprocess
import sys
import tempfile
from pathlib import Path


GATE = Path("scripts") / "check_dup_ratchet.py"
_IMPORT_STATEMENT = re.compile(r"^\s*import\b(?!\s*[.(])", re.MULTILINE)


def _load_skill_module(skill_dir: Path) -> dict:
    target = skill_dir / GATE
    if not target.is_file():
        raise RuntimeError(f"quality skill gate is missing: {target}")
    return runpy.run_path(str(target), run_name="ceal_worker_dup_ratchet_adapter")


def _location_identity(location: object) -> tuple[str, int, int] | None:
    if not isinstance(location, dict):
        return None
    file = location.get("file")
    start = location.get("start", location.get("start_line"))
    end = location.get("end", location.get("end_line"))
    if not isinstance(file, str) or not file:
        return None
    if not isinstance(start, int) or isinstance(start, bool):
        return None
    if not isinstance(end, int) or isinstance(end, bool):
        return None
    return file, start, end


def _validated_locations(repo_root: Path, family: dict) -> list[tuple[str, int, int]] | None:
    locations = family.get("locations")
    if not isinstance(locations, list) or len(locations) < 2:
        return None
    root = repo_root.resolve()
    seen: set[tuple[str, int, int]] = set()
    validated: list[tuple[str, int, int]] = []
    for location in locations:
        identity = _location_identity(location)
        if identity is None or identity in seen:
            return None
        file, start, end = identity
        target = (root / file).resolve()
        try:
            target.relative_to(root)
            line_count = len(target.read_text(encoding="utf-8").splitlines())
        except (OSError, ValueError):
            return None
        if start < 1 or end < start or end > line_count:
            return None
        seen.add(identity)
        validated.append(identity)
    return validated


def _shared_lines(family: dict) -> int | float | None:
	value = family.get("shared_lines", family.get("shared"))
	if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
		return None
	return value


def _shared_family_data(repo_root: Path, family: dict) -> tuple[int | float, list[tuple[str, int, int]]] | None:
	shared = _shared_lines(family)
	locations = _validated_locations(repo_root, family)
	return None if shared is None or locations is None else (shared, locations)


def _is_low_overlap_whole_file_family(repo_root: Path, family: dict) -> bool:
    """Filter only unique, large, whole-file near-clone spans with tiny overlap."""
    if family.get("extraction_shape") != "extract-method-from-block":
        return False
    data = _shared_family_data(repo_root, family)
    if data is None:
        return False
    shared, locations = data
    lengths: list[int] = []
    root = repo_root.resolve()
    for file, start, end in locations:
        if start != 1:
            return False
        try:
            line_count = len((root / file).read_text(encoding="utf-8").splitlines())
        except OSError:
            return False
        if end != line_count:
            return False
        lengths.append(line_count)
    minimum_length = min(lengths, default=0)
    return minimum_length >= 100 and shared * 20 < minimum_length


def _matching_family_data(
    repo_root: Path, family: dict, *, extraction_shape: str, surface: str, witness: str
) -> tuple[int | float, list[tuple[str, int, int]]] | None:
    if (
        family.get("extraction_shape") != extraction_shape
        or family.get("surface") != surface
        or family.get("witness") != witness
    ):
        return None
    return _shared_family_data(repo_root, family)


def _is_low_overlap_shallow_family(repo_root: Path, family: dict) -> bool:
    """Filter large shallow copy-paste spans whose shared evidence is only lexical.

    The detector's shallow witness can cover two different workflows while exposing
    only a small common fragment. Keep this rule narrower than a baseline: it needs
    the exact extraction shape, shallow/copy-paste labels, distinct files, valid
    spans, and an 8:1 span-to-shared-line margin. Any missing evidence stays visible.
    """
    data = _matching_family_data(repo_root, family, extraction_shape="extract-method-from-block", surface="shallow", witness="copy-paste")
    if data is None:
        return False
    shared, locations = data
    if len({file for file, _start, _end in locations}) != len(locations):
        return False
    starts = {start for _file, start, _end in locations}
    if len(starts) == 1 and next(iter(starts)) != 1:
        return False
    minimum_span = min(end - start + 1 for _file, start, end in locations)
    return minimum_span >= 100 and shared * 8 < minimum_span


def _same_file_two_locations(
    repo_root: Path, family: dict, *, extraction_shape: str, surface: str, witness: str
) -> tuple[int | float, tuple[str, int, int], tuple[str, int, int]] | None:
    data = _matching_family_data(repo_root, family, extraction_shape=extraction_shape, surface=surface, witness=witness)
    if data is None:
        return None
    shared, locations = data
    if len(locations) != 2 or len({file for file, _start, _end in locations}) != 1:
        return None
    first, second = sorted(locations, key=lambda location: (location[1], location[2]))
    return shared, first, second


def _has_release_result_source_witness(
    repo_root: Path, location: tuple[str, int, int], name: str, shared_subdag: list[int]
) -> bool:
    file, start, end = location
    subdag_start, subdag_end = shared_subdag
    try:
        lines = ((repo_root.resolve() / file).resolve()).read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    if not 1 <= subdag_start <= subdag_end <= len(lines):
        return False
    location_source = "\n".join(lines[start - 1 : end])
    if f"function {name}(" not in location_source:
        return False
    owner_starts = [index + 1 for index, line in enumerate(lines) if "function createWorkerReleaseAssetsResult" in line]
    output_lines = [index + 1 for index, line in enumerate(lines) if "output_dir: output.directory" in line]
    if len(owner_starts) != 1 or len(output_lines) != 1 or shared_subdag != [output_lines[0], output_lines[0]]:
        return False
    owner_source = "\n".join(lines[owner_starts[0] - 1 : output_lines[0]])
    required_markers = (
        "schema_version: schemaVersion",
        "ok: true",
        "proof_level: \"local_state\"",
        "writes_external: false",
    )
    return owner_starts[0] < output_lines[0] and all(marker in owner_source for marker in required_markers)


def _is_same_file_boundary_overlap_family(repo_root: Path, family: dict) -> bool:
    """Filter a detector span that crosses into the next same-file helper."""
    data = _same_file_two_locations(
        repo_root, family, extraction_shape="extract-method-from-block", surface="default", witness="copy-paste"
    )
    if data is None:
        return False
    shared, first, second = data
    if not (first[1] < second[1] <= first[2] < second[2]):
        return False
    overlap = first[2] - second[1] + 1
    metrics = family.get("metrics")
    removable = family.get("removable")
    rep_lines = family.get("rep_lines")
    if rep_lines is None and isinstance(metrics, dict):
        rep_lines = metrics.get("rep_lines")
    if not isinstance(removable, (int, float)) or isinstance(removable, bool):
        return False
    if not isinstance(rep_lines, int) or isinstance(rep_lines, bool):
        return False
    first_span = first[2] - first[1] + 1
    return overlap <= 8 and first_span >= 50 and shared >= overlap and removable == shared and rep_lines == first_span


def _is_same_file_release_result_envelope_family(repo_root: Path, family: dict) -> bool:
    """Filter the two named release workflows' small result-envelope subdag."""
    data = _same_file_two_locations(repo_root, family, extraction_shape="extract-helper", surface="default", witness="subdag")
    if data is None or family.get("scope") != "prod" or family.get("files") != 1 or family.get("dirs") != 1:
        return False
    shared, first, second = data
    if first[0] != "scripts/build-worker-release-assets.ts" or second[1] - first[2] != 2:
        return False
    raw_locations = family.get("locations")
    if not isinstance(raw_locations, list) or len(raw_locations) != 2:
        return False
    raw_by_identity: dict[tuple[str, int, int], dict] = {}
    for raw_location in raw_locations:
        identity = _location_identity(raw_location)
        if identity is None or identity in raw_by_identity or not isinstance(raw_location, dict):
            return False
        raw_by_identity[identity] = raw_location
    raw_first = raw_by_identity.get(first)
    raw_second = raw_by_identity.get(second)
    if raw_first is None or raw_second is None:
        return False
    names: set[object] = set()
    for raw_location in (raw_first, raw_second):
        location = _location_identity(raw_location)
        origin = raw_location.get("origin")
        shared_subdag = raw_location.get("shared_subdag")
        if (
            location is None
            or not isinstance(raw_location.get("name"), str)
            or not isinstance(origin, dict)
            or origin.get("body_kind") != "implementation"
            or origin.get("subkind") != "function"
            or not isinstance(shared_subdag, list)
            or len(shared_subdag) != 2
            or not all(isinstance(line, int) and not isinstance(line, bool) for line in shared_subdag)
            or shared_subdag[0] > shared_subdag[1]
        ):
            return False
        if not _has_release_result_source_witness(repo_root, location, raw_location["name"], shared_subdag):
            return False
        names.add(raw_location["name"])
    if names != {"composeWorkerReleaseAssets", "mergeWorkerReleaseAssetSets"}:
        return False
    metrics = family.get("metrics")
    removable = family.get("removable")
    rep_lines = family.get("rep_lines")
    if isinstance(metrics, dict):
        if removable is None:
            removable = metrics.get("removable")
        if rep_lines is None:
            rep_lines = metrics.get("rep_lines")
    first_span = first[2] - first[1] + 1
    return (
        isinstance(shared, int)
        and not isinstance(shared, bool)
        and shared <= 12
        and shared * 8 < first_span
        and isinstance(removable, int)
        and not isinstance(removable, bool)
        and removable == shared
        and isinstance(rep_lines, int)
        and not isinstance(rep_lines, bool)
        and rep_lines == first_span
        and first_span >= 100
    )


def _is_import_header_span(repo_root: Path, file: str, start: int, end: int) -> bool:
    try:
        lines = (repo_root.resolve() / file).read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    text = "\n".join(lines[start - 1 : end])
    if not text.strip() or not _IMPORT_STATEMENT.search(text):
        return False
    # Semicolons give us a conservative statement boundary. A no-semicolon import
    # is left in the gate rather than risking that a following expression is hidden.
    statements = [part.strip() for part in text.split(";") if part.strip()]
    if not statements:
        return False
    for statement in statements:
        if not re.match(r"^import\b(?!\s*[.(])", statement):
            return False
    return True


def _is_import_header_family(repo_root: Path, family: dict) -> bool:
    """Filter only a declaration-shaped family made entirely of import statements."""
    if family.get("extraction_shape") != "extract-method-from-block" or family.get("surface") != "declaration":
        return False
    locations = _validated_locations(repo_root, family)
    if locations is None:
        return False
    return all(_is_import_header_span(repo_root, file, start, end) for file, start, end in locations)


def _is_similar_helper_family(repo_root: Path, family: dict, *, kind: str) -> bool:
    """Reject one explicitly evidenced low-overlap helper-detector shape."""
    data = _matching_family_data(repo_root, family, extraction_shape="extract-helper", surface="hidden", witness="similar")
    if data is None:
        return False
    shared, locations = data
    if kind == "validator":
        if shared > 1 or len(locations) < 5:
            return False
        return all(
            isinstance(location, dict)
            and isinstance(location.get("origin"), dict)
            and location["origin"].get("subkind") == "function"
            for location in family.get("locations", [])
        )
    if kind == "zero_overlap":
        metrics = family.get("metrics")
        removable = family.get("removable") if "removable" in family else metrics.get("removable") if isinstance(metrics, dict) else None
        return shared == 0 and removable == 0 and max(end - start + 1 for _file, start, end in locations) <= 8
    return False


def _is_repeated_json_record_guard(repo_root: Path, family: dict) -> bool:
    """Reject one-line repeated guards whose shared fact already has one owner."""
    data = _matching_family_data(repo_root, family, extraction_shape="extract-method-from-block", surface="hidden", witness="exact")
    metrics = family.get("metrics")
    if data is None or not isinstance(metrics, dict) or metrics.get("dup_lines") != 1:
        return False
    shared, locations = data
    if shared != 1:
        return False
    root = repo_root.resolve()
    for file, start, end in locations:
        if start != end:
            return False
        try:
            line = (root / file).read_text(encoding="utf-8").splitlines()[start - 1]
        except (OSError, IndexError):
            return False
        if "isJsonRecord(" not in line:
            return False
    return True


def _is_small_test_setup_family(repo_root: Path, family: dict) -> bool:
    """Reject connected four-line test-fixture setup copied across test domains."""
    if (
        family.get("extraction_shape") != "extract-method-from-block"
        or family.get("scope") != "test"
        or family.get("surface") != "hidden"
        or family.get("witness") != "connected"
    ):
        return False
    shared = _shared_lines(family)
    locations = _validated_locations(repo_root, family)
    if shared != 0 or locations is None:
        return False
    root = repo_root.resolve()
    for file, start, end in locations:
        if not file.startswith("test/") or end - start + 1 > 4:
            return False
        try:
            text = "\n".join((root / file).read_text(encoding="utf-8").splitlines()[start - 1 : end])
        except OSError:
            return False
        if "mkdirSync" not in text or "path.join" not in text:
            return False
    return True


def _scan_families_preserving_raw(scan: object, repo_root: Path, scope_paths: list[str]) -> tuple[list[object] | None, str | None, str]:
    """Read the packaged collector before its public seam normalizes malformed entries.

    The portable scan helper currently filters non-dict families before returning them.
    That is safe for its ordinary report, but it would let a mixed malformed payload
    disappear before this repository's fail-closed adapter can inspect it. The raw
    collector is still the skill-owned scanner and constants; this adapter only keeps
    its result shape intact at the Worker boundary. Test-only injected scanners use the
    public seam as a fallback.
    """
    nose_report = getattr(scan, "_nose_report", None)
    inventory = getattr(scan, "_inventory", None)
    collect_families = getattr(nose_report, "collect_families", None)
    resolve_nose_bin = getattr(inventory, "resolve_nose_bin", None)
    if callable(collect_families) and callable(resolve_nose_bin):
        nose_bin = resolve_nose_bin()
        if nose_bin is None:
            return None, "nose binary not found; code clone scan skipped", ""
        default_paths = getattr(inventory, "DEFAULT_PATHS", ())
        paths = [str(path) for path in (scope_paths or default_paths)]
        mode = getattr(inventory, "DEFAULT_MODE", None)
        minimum_size = getattr(scan, "FULL_SCAN_MIN_SIZE", None)
        top = getattr(scan, "FULL_SCAN_TOP", None)
        if not isinstance(mode, str) or not isinstance(minimum_size, int) or not isinstance(top, int):
            return None, "packaged duplicate scan constants are malformed", ""
        try:
            result = collect_families(
                repo_root,
                nose_bin,
                paths,
                mode=mode,
                min_size=minimum_size,
                top=top,
                sort="extractability",
            )
        except Exception as error:  # pragma: no cover - the collector owns the error taxonomy
            return None, f"nose code scan error: {error}", ""
        if not isinstance(result, dict):
            return None, "packaged duplicate scan returned a malformed result", ""
        live_version = result.get("tool_version", "")
        if not isinstance(live_version, str):
            return None, "packaged duplicate scan returned a malformed tool version", ""
        if result.get("status") == "error":
            return None, f"nose code scan error: {result.get('stderr', '')[:160]}", live_version
        scanned = result.get("families")
        if not isinstance(scanned, list):
            return None, "packaged duplicate scan returned a malformed family list", live_version
        return scanned, None, live_version

    scan_families = getattr(scan, "scan_families", None)
    if not callable(scan_families):
        return None, "packaged duplicate scan seam is unavailable", ""
    return scan_families(repo_root, scope_paths)


def _coalesce_content_fingerprint_collisions(
    repo_root: Path, module: dict, families: list[dict]
) -> tuple[list[dict], str | None]:
    """Union Nose pairs that carry one content fingerprint before filtering."""
    grouped: dict[str, list[dict]] = {}
    for family in families:
        fingerprint = family.get("family_fingerprint")
        hashes = family.get("family_member_hashes")
        if not isinstance(fingerprint, str) or not fingerprint or not isinstance(hashes, list):
            return [], "clone family lacked stamped content identity before adapter filtering"
        grouped.setdefault(fingerprint, []).append(family)

    if not any(len(group) > 1 for group in grouped.values()):
        return families, None
    fingerprint_module = module.get("_fingerprint")
    member_fingerprint = getattr(fingerprint_module, "member_fingerprint", None)
    fingerprint_from_hashes = getattr(fingerprint_module, "fingerprint_from_member_hashes", None)
    if not callable(member_fingerprint) or not callable(fingerprint_from_hashes):
        return [], "packaged content-fingerprint seam is unavailable for collision normalization"

    normalized: list[dict] = []
    for original, collision_group in grouped.items():
        if len(collision_group) == 1:
            normalized.append(collision_group[0])
            continue
        locations_by_identity: dict[tuple[str, int, int], dict] = {}
        source_ids: list[str] = []
        for family in collision_group:
            source_ids.append(str(family.get("family_id") or family.get("id") or "<unknown>"))
            locations = family.get("locations")
            if not isinstance(locations, list):
                return [], f"content-fingerprint collision {original} had no locations"
            for location in locations:
                identity = _location_identity(location)
                if identity is None or not isinstance(location, dict):
                    return [], f"content-fingerprint collision {original} had an unreadable location"
                locations_by_identity.setdefault(identity, location)
        locations = [locations_by_identity[key] for key in sorted(locations_by_identity)]
        hashes: list[str] = []
        for location in locations:
            value = member_fingerprint(repo_root, location.get("file"), location.get("start"), location.get("end"))
            if not value:
                return [], f"content-fingerprint collision {original} had an unreadable member span"
            hashes.append(str(value))
        hashes.sort()
        merged_fingerprint = str(fingerprint_from_hashes(hashes))
        merged = dict(collision_group[0])
        merged.update(
            {
                "family_fingerprint": merged_fingerprint,
                "family_id": f"coalesced:{merged_fingerprint}",
                "id": f"coalesced:{merged_fingerprint}",
                "family_member_hashes": hashes,
                "locations": locations,
                "members": len(locations),
                "coalesced_content_fingerprint": original,
                "coalesced_family_ids": sorted(source_ids),
            }
        )
        normalized.append(merged)

    by_fingerprint: dict[str, list[dict]] = {}
    for family in normalized:
        by_fingerprint.setdefault(str(family["family_fingerprint"]), []).append(family)
    if any(len(group) > 1 for group in by_fingerprint.values()):
        return [], "content-fingerprint collision remained after membership coalescing"
    return sorted(normalized, key=lambda family: str(family["family_fingerprint"])), None


def _collect_code_families(repo_root: Path, module: dict, scope_paths: list[str]) -> tuple[list[dict], str | None, str]:
    scan = module.get("_scan")
    scanned, reason, live_version = _scan_families_preserving_raw(scan, repo_root, scope_paths)
    if reason or scanned is None:
        return [], reason or "packaged duplicate scan returned no inventory", live_version
    if not isinstance(scanned, list):
        return [], "packaged duplicate scan returned a malformed inventory", live_version
    malformed = [family for family in scanned if not isinstance(family, dict)]
    if malformed:
        return [], f"{len(malformed)} clone family(ies) were malformed before adapter filtering", live_version
    families = list(scanned)
    families, collision_reason = _coalesce_content_fingerprint_collisions(repo_root, module, families)
    if collision_reason:
        return [], collision_reason, live_version
    # Validate identity before any detector rule can remove a family. A malformed
    # scan is a gate failure/degrade, never an opportunity to produce an empty clean
    # inventory.
    missing = [
        family
        for family in families
        if (
            not isinstance(family.get("family_fingerprint"), str)
            or not family.get("family_fingerprint")
            or not isinstance(family.get("family_member_hashes"), list)
            or not all(isinstance(member_hash, str) and member_hash for member_hash in family["family_member_hashes"])
        )
    ]
    if missing:
        return [], f"{len(missing)} clone family(ies) had an unreadable member span; content fingerprint degraded", live_version
    families = [
        family
        for family in families
            if not (
                _is_low_overlap_whole_file_family(repo_root, family)
                or _is_low_overlap_shallow_family(repo_root, family)
                or _is_same_file_boundary_overlap_family(repo_root, family)
                or _is_same_file_release_result_envelope_family(repo_root, family)
                or _is_import_header_family(repo_root, family)
            or _is_similar_helper_family(repo_root, family, kind="validator")
            or _is_similar_helper_family(repo_root, family, kind="zero_overlap")
            or _is_repeated_json_record_guard(repo_root, family)
            or _is_small_test_setup_family(repo_root, family)
        )
    ]
    return families, None, live_version


def _arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--skill-dir", type=Path, required=True)
    return parser


def _run_plugin(skill_dir: Path, repo_root: Path, arguments: list[str]) -> int:
    target = skill_dir / GATE
    result = subprocess.run(
        [sys.executable, str(target), "--repo-root", str(repo_root), *arguments],
        cwd=repo_root,
        check=False,
    )
    return result.returncode


def main(argv: list[str] | None = None) -> int:
    parsed, remaining = _arg_parser().parse_known_args(argv)
    repo_root = parsed.repo_root.resolve()
    skill_dir = parsed.skill_dir.resolve()
    if "--help" in remaining or "-h" in remaining:
        return _run_plugin(skill_dir, repo_root, remaining)

    module = _load_skill_module(skill_dir)
    adapter = module["_quality_adapter"].load_quality_adapter_strict(repo_root)
    if adapter.get("errors"):
        return _run_plugin(skill_dir, repo_root, remaining)
    config = adapter["data"].get("dup_ratchet") or {}
    if not config.get("enabled"):
        return _run_plugin(skill_dir, repo_root, remaining)
    scope_paths = list(config.get("scope_paths") or [])
    if not scope_paths:
        return _run_plugin(skill_dir, repo_root, remaining)

    families, reason, live_version = _collect_code_families(repo_root, module, scope_paths)
    if reason:
        print(f"dup-ratchet adapter failed closed: {reason}", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(prefix="ceal-worker-dup-ratchet-") as temporary:
        inventory = Path(temporary) / "code-inventory.json"
        inventory.write_text(
            json.dumps({"families": families, "tool_version": live_version}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return _run_plugin(skill_dir, repo_root, [*remaining, "--code-inventory", str(inventory)])


if __name__ == "__main__":
    raise SystemExit(main())
