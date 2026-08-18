import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Worker duplicate adapter filters only evidenced detector-only families", () => {
	const result = spawnSync(
		"python3",
		[
			"-c",
			`
import json
import runpy
import shutil
import tempfile
from pathlib import Path

module = runpy.run_path("scripts/run_dup_ratchet.py", run_name="worker_dup_adapter_test")
root = Path(tempfile.mkdtemp())
try:
    source = root / "src"
    source.mkdir()
    worker_scripts = root / "scripts"
    worker_scripts.mkdir()
    release_source = ["line;\\n"] * 120
    release_source[0] = "function createWorkerReleaseAssetsResult(output, schemaVersion, details) {\\n"
    release_source[1] = "schema_version: schemaVersion,\\n"
    release_source[2] = "writes_external: false,\\n"
    release_source[3] = "ok: true,\\n"
    release_source[4] = 'proof_level: "local_state",\\n'
    release_source[9] = "function composeWorkerReleaseAssets(output) {\\n"
    release_source[101] = "function mergeWorkerReleaseAssetSets(output) {\\n"
    release_source[65] = "output_dir: output.directory,\\n"
    (worker_scripts / "build-worker-release-assets.ts").write_text("".join(release_source), encoding="utf-8")
    for name in ("validator-a.ts", "validator-b.ts", "validator-c.ts", "validator-d.ts", "validator-e.ts"):
        (source / name).write_text("function validate() {}\\n", encoding="utf-8")
    (source / "zero-a.ts").write_text("zero;\\n", encoding="utf-8")
    (source / "zero-b.ts").write_text("zero;\\n", encoding="utf-8")
    (source / "json-a.ts").write_text("const value = isJsonRecord(input);\\n", encoding="utf-8")
    (source / "json-b.ts").write_text("const value = isJsonRecord(input);\\n", encoding="utf-8")
    (source / "json-control.ts").write_text("const value = isStringMap(input);\\n", encoding="utf-8")
    test_root = root / "test"
    test_root.mkdir()
    setup = "import path from 'node:path';\\nfs.mkdirSync(path.join(root, 'fixture'));\\nwriteFixture();\\ncloseFixture();\\n"
    (test_root / "setup-a.ts").write_text(setup, encoding="utf-8")
    (test_root / "setup-b.ts").write_text(setup, encoding="utf-8")
    (test_root / "setup-control.ts").write_text("fs.mkdirSync(root);\\nwriteFixture();\\ncloseFixture();\\n", encoding="utf-8")
    (source / "a.ts").write_text("import { a } from \\"a\\";\\n" + "line;\\n" * 199, encoding="utf-8")
    (source / "b.ts").write_text("import { b } from \\"b\\";\\n" + "line;\\n" * 199, encoding="utf-8")
    (source / "same-file.ts").write_text("line;\\n" * 120, encoding="utf-8")
    whole = {
        "extraction_shape": "extract-method-from-block",
        "surface": "shallow",
        "witness": "copy-paste",
        "family_fingerprint": "whole",
        "family_member_hashes": ["a", "b"],
        "shared": 7,
        "locations": [
            {"file": "src/a.ts", "start": 1, "end": 200},
            {"file": "src/b.ts", "start": 1, "end": 200},
        ],
    }
    shallow = {
        **whole,
        "family_fingerprint": "shallow",
        "locations": [
            {"file": "src/a.ts", "start": 1, "end": 150},
            {"file": "src/b.ts", "start": 1, "end": 150},
        ],
        "shared": 9,
    }
    same_file_overlap = {
        "extraction_shape": "extract-method-from-block",
        "surface": "default",
        "witness": "copy-paste",
        "scope": "prod",
        "family_fingerprint": "same-file-overlap",
        "family_member_hashes": ["same-file-overlap"],
        "shared": 8,
        "removable": 8,
        "rep_lines": 93,
        "metrics": {"dup_lines": 64, "removable": 8, "rep_lines": 93},
        "locations": [
            {"file": "src/same-file.ts", "start": 1, "end": 93},
            {"file": "src/same-file.ts", "start": 89, "end": 120},
        ],
    }
    same_file_overlap_control = {**same_file_overlap, "family_fingerprint": "same-file-overlap-control", "removable": 7, "metrics": {"dup_lines": 64, "removable": 7, "rep_lines": 93}}
    same_file_overlap_geometry_control = {**same_file_overlap, "family_fingerprint": "same-file-overlap-geometry-control", "locations": [
        {"file": "src/same-file.ts", "start": 1, "end": 93},
        {"file": "src/same-file.ts", "start": 94, "end": 120},
    ]}
    same_file_result_envelope = {
        "extraction_shape": "extract-helper",
        "surface": "default",
        "witness": "subdag",
        "scope": "prod",
        "files": 1,
        "dirs": 1,
        "family_fingerprint": "same-file-result-envelope",
        "family_member_hashes": ["same-file-result-envelope-a", "same-file-result-envelope-b"],
        "shared": 11,
        "removable": 11,
        "rep_lines": 100,
        "metrics": {"dup_lines": 156, "removable": 11, "rep_lines": 100},
        "locations": [
            {"file": "scripts/build-worker-release-assets.ts", "start": 1, "end": 100, "name": "composeWorkerReleaseAssets", "origin": {"body_kind": "implementation", "subkind": "function"}, "shared_subdag": [66, 66]},
            {"file": "scripts/build-worker-release-assets.ts", "start": 102, "end": 120, "name": "mergeWorkerReleaseAssetSets", "origin": {"body_kind": "implementation", "subkind": "function"}, "shared_subdag": [66, 66]},
        ],
    }
    same_file_result_envelope_control = {**same_file_result_envelope, "family_fingerprint": "same-file-result-envelope-control", "locations": [
        {**same_file_result_envelope["locations"][0]},
        {**same_file_result_envelope["locations"][1], "name": "mergeOtherReleaseAssetSets"},
    ]}
    same_file_result_envelope_source_control = {**same_file_result_envelope, "family_fingerprint": "same-file-result-envelope-source-control", "locations": [
        {**same_file_result_envelope["locations"][0], "shared_subdag": [67, 67]},
        {**same_file_result_envelope["locations"][1], "shared_subdag": [67, 67]},
    ]}
    near_threshold = {
        **shallow,
        "family_fingerprint": "near-threshold",
        "locations": [
            {"file": "src/a.ts", "start": 1, "end": 108},
            {"file": "src/b.ts", "start": 1, "end": 108},
        ],
        "shared": 13,
    }
    near_threshold_control = {**near_threshold, "family_fingerprint": "near-threshold-control", "shared": 14}
    import_family = {
        **whole,
        "family_fingerprint": "imports",
        "surface": "declaration",
        "locations": [
            {"file": "src/a.ts", "start": 1, "end": 1},
            {"file": "src/b.ts", "start": 1, "end": 1},
        ],
    }
    high_overlap = {**shallow, "family_fingerprint": "high", "shared": 20}
    wrong_shape = {**shallow, "family_fingerprint": "shape", "extraction_shape": "copy-paste"}
    partial = {**shallow, "family_fingerprint": "partial", "locations": [
        {"file": "src/a.ts", "start": 2, "end": 151},
        {"file": "src/b.ts", "start": 2, "end": 151},
    ]}
    duplicate_location = {**shallow, "family_fingerprint": "duplicate", "locations": [shallow["locations"][0], shallow["locations"][0]]}
    validator_locations = [
        {"file": f"src/validator-{name}.ts", "start": 1, "end": 1, "origin": {"subkind": "function"}}
        for name in ("a", "b", "c", "d", "e")
    ]
    validator = {
        "extraction_shape": "extract-helper",
        "surface": "hidden",
        "witness": "similar",
        "family_fingerprint": "validator",
        "family_member_hashes": ["validator"],
        "shared": 1,
        "locations": validator_locations,
    }
    validator_control = {**validator, "family_fingerprint": "validator-control", "shared": 2}
    zero_overlap = {
        "extraction_shape": "extract-helper",
        "surface": "hidden",
        "witness": "similar",
        "family_fingerprint": "zero-overlap",
        "family_member_hashes": ["zero-overlap"],
        "shared": 0,
        "metrics": {"removable": 0},
        "locations": [
            {"file": "src/zero-a.ts", "start": 1, "end": 1},
            {"file": "src/zero-b.ts", "start": 1, "end": 1},
        ],
    }
    zero_overlap_control = {**zero_overlap, "family_fingerprint": "zero-overlap-control", "metrics": {"removable": 1}}
    repeated_json = {
        "extraction_shape": "extract-method-from-block",
        "surface": "hidden",
        "witness": "exact",
        "family_fingerprint": "repeated-json",
        "family_member_hashes": ["repeated-json"],
        "shared": 1,
        "metrics": {"dup_lines": 1},
        "locations": [
            {"file": "src/json-a.ts", "start": 1, "end": 1},
            {"file": "src/json-b.ts", "start": 1, "end": 1},
        ],
    }
    repeated_json_control = {**repeated_json, "family_fingerprint": "repeated-json-control", "locations": [
        {"file": "src/json-a.ts", "start": 1, "end": 1},
        {"file": "src/json-control.ts", "start": 1, "end": 1},
    ]}
    small_test_setup = {
        "extraction_shape": "extract-method-from-block",
        "surface": "hidden",
        "witness": "connected",
        "scope": "test",
        "family_fingerprint": "small-test-setup",
        "family_member_hashes": ["small-test-setup"],
        "shared": 0,
        "locations": [
            {"file": "test/setup-a.ts", "start": 1, "end": 4},
            {"file": "test/setup-b.ts", "start": 1, "end": 4},
        ],
    }
    small_test_setup_control = {**small_test_setup, "family_fingerprint": "small-test-setup-control", "locations": [
        {"file": "test/setup-a.ts", "start": 1, "end": 4},
        {"file": "test/setup-control.ts", "start": 1, "end": 3},
    ]}
    class Scan:
        @staticmethod
        def scan_families(repo_root, scope_paths):
            return [
                whole, shallow, same_file_overlap, same_file_overlap_control, same_file_result_envelope, same_file_result_envelope_control, same_file_result_envelope_source_control, near_threshold, near_threshold_control, import_family, high_overlap, wrong_shape, partial, duplicate_location,
                validator, validator_control, zero_overlap, zero_overlap_control,
                repeated_json, repeated_json_control, small_test_setup, small_test_setup_control,
            ], None, "0.20.0"
    malformed_identity = {**whole, "family_fingerprint": "malformed-identity", "family_member_hashes": [None]}
    class MalformedScan:
        @staticmethod
        def scan_families(repo_root, scope_paths):
            return [None, malformed_identity], None, "0.20.0"
    class RawInventory:
        DEFAULT_PATHS = []
        DEFAULT_MODE = "default"
        @staticmethod
        def resolve_nose_bin():
            return "nose"
    class RawNoseReport:
        @staticmethod
        def collect_families(repo_root, nose_bin, paths, **options):
            return {"tool_version": "0.20.0", "families": [None, whole]}
    class RawScan:
        _inventory = RawInventory()
        _nose_report = RawNoseReport()
        FULL_SCAN_MIN_SIZE = 24
        FULL_SCAN_TOP = 1000000
    collected, reason, version = module["_collect_code_families"](root, {"_scan": Scan()}, ["src"])
    malformed_collected, malformed_reason, malformed_version = module["_collect_code_families"](
        root, {"_scan": MalformedScan()}, ["src"]
    )
    raw_malformed_collected, raw_malformed_reason, raw_malformed_version = module["_collect_code_families"](
        root, {"_scan": RawScan()}, ["src"]
    )
    print(json.dumps({
        "reason": reason,
        "version": version,
        "kept": sorted(f["family_fingerprint"] for f in collected),
        "whole": module["_is_low_overlap_whole_file_family"](root, whole),
        "whole_partial": module["_is_low_overlap_whole_file_family"](root, partial),
        "shallow": module["_is_low_overlap_shallow_family"](root, shallow),
        "same_file_overlap": module["_is_same_file_boundary_overlap_family"](root, same_file_overlap),
        "same_file_overlap_control": module["_is_same_file_boundary_overlap_family"](root, same_file_overlap_control),
        "same_file_overlap_geometry_control": module["_is_same_file_boundary_overlap_family"](root, same_file_overlap_geometry_control),
        "same_file_result_envelope": module["_is_same_file_release_result_envelope_family"](root, same_file_result_envelope),
        "same_file_result_envelope_control": module["_is_same_file_release_result_envelope_family"](root, same_file_result_envelope_control),
        "same_file_result_envelope_source_control": module["_is_same_file_release_result_envelope_family"](root, same_file_result_envelope_source_control),
        "near_threshold": module["_is_low_overlap_shallow_family"](root, near_threshold),
        "near_threshold_control": module["_is_low_overlap_shallow_family"](root, near_threshold_control),
        "imports": module["_is_import_header_family"](root, import_family),
        "high_overlap": module["_is_low_overlap_shallow_family"](root, high_overlap),
        "wrong_shape": module["_is_low_overlap_shallow_family"](root, wrong_shape),
        "partial": module["_is_low_overlap_shallow_family"](root, partial),
        "duplicate_location": module["_is_low_overlap_shallow_family"](root, duplicate_location),
        "validator": module["_is_similar_helper_family"](root, validator, kind="validator"),
        "validator_control": module["_is_similar_helper_family"](root, validator_control, kind="validator"),
        "zero_overlap": module["_is_similar_helper_family"](root, zero_overlap, kind="zero_overlap"),
        "zero_overlap_control": module["_is_similar_helper_family"](root, zero_overlap_control, kind="zero_overlap"),
        "repeated_json": module["_is_repeated_json_record_guard"](root, repeated_json),
        "repeated_json_control": module["_is_repeated_json_record_guard"](root, repeated_json_control),
        "small_test_setup": module["_is_small_test_setup_family"](root, small_test_setup),
        "small_test_setup_control": module["_is_small_test_setup_family"](root, small_test_setup_control),
        "malformed_scan": malformed_collected == [] and malformed_reason is not None and malformed_version == "0.20.0",
        "malformed_packaged_scan": raw_malformed_collected == [] and raw_malformed_reason is not None and raw_malformed_version == "0.20.0",
    }))
finally:
    shutil.rmtree(root)
`,
		],
		{ cwd: process.cwd(), encoding: "utf8" },
	);

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.deepEqual(JSON.parse(result.stdout), {
		reason: null,
		version: "0.20.0",
		kept: [
			"duplicate",
			"high",
			"near-threshold-control",
			"partial",
			"repeated-json-control",
			"same-file-overlap-control",
			"same-file-result-envelope-control",
			"same-file-result-envelope-source-control",
			"shape",
			"small-test-setup-control",
			"validator-control",
			"zero-overlap-control",
		],
		whole: true,
		whole_partial: false,
		shallow: true,
		same_file_overlap: true,
		same_file_overlap_control: false,
		same_file_overlap_geometry_control: false,
		same_file_result_envelope: true,
		same_file_result_envelope_control: false,
		same_file_result_envelope_source_control: false,
		near_threshold: true,
		near_threshold_control: false,
		imports: true,
		high_overlap: false,
		wrong_shape: false,
		partial: false,
		duplicate_location: false,
		validator: true,
		validator_control: false,
		zero_overlap: true,
		zero_overlap_control: false,
		repeated_json: true,
		repeated_json_control: false,
		small_test_setup: true,
		small_test_setup_control: false,
		malformed_scan: true,
		malformed_packaged_scan: true,
	});
});
