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
                whole, shallow, import_family, high_overlap, wrong_shape, partial, duplicate_location,
                validator, validator_control, zero_overlap, zero_overlap_control,
                repeated_json, repeated_json_control, small_test_setup, small_test_setup_control,
            ], None, "0.20.0"
    malformed_identity = {**whole, "family_fingerprint": "malformed-identity", "family_member_hashes": [None]}
    class MalformedScan:
        @staticmethod
        def scan_families(repo_root, scope_paths):
            return [None, malformed_identity], None, "0.20.0"
    collected, reason, version = module["_collect_code_families"](root, {"_scan": Scan()}, ["src"])
    malformed_collected, malformed_reason, malformed_version = module["_collect_code_families"](
        root, {"_scan": MalformedScan()}, ["src"]
    )
    print(json.dumps({
        "reason": reason,
        "version": version,
        "kept": sorted(f["family_fingerprint"] for f in collected),
        "whole": module["_is_low_overlap_whole_file_family"](root, whole),
        "whole_partial": module["_is_low_overlap_whole_file_family"](root, partial),
        "shallow": module["_is_low_overlap_shallow_family"](root, shallow),
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
			"partial",
			"repeated-json-control",
			"shape",
			"small-test-setup-control",
			"validator-control",
			"zero-overlap-control",
		],
		whole: true,
		whole_partial: false,
		shallow: true,
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
	});
});
