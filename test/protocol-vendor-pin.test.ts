import { validateProtocolVendorPin } from "../scripts/verify-protocol-vendor-pin.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type GatewayHandoffLock = { gateway: { commit: string; protocol_tree: string } };
type ProtocolVendorPin = {
	source: { commit: string; tree: string };
	shipped: { lock_file: string; gateway_commit: string; status: string; protocol_tree: string };
};

function readPin(): ProtocolVendorPin {
	return JSON.parse(readFileSync(path.join(ROOT, "protocol-vendor-pin.json"), "utf8")) as ProtocolVendorPin;
}

const LOCK = JSON.parse(readFileSync(path.join(ROOT, "gateway-protocol-handoff-lock.json"), "utf8")) as GatewayHandoffLock;

// This file is intentionally in the release tier. These assertions bind the
// real checkout and release-input records; the contract-tier sibling contains
// only injected validator fixtures and must stay independent of this state.
test("the vendored protocol copy matches its recorded Gateway source", () => {
	const result = validateProtocolVendorPin({ repoRoot: ROOT });
	assert.equal(result.vendored.tree, result.source.tree);
	assert.equal(result.shipped.gateway_commit, LOCK.gateway.commit);
	assert.equal(result.diverged, false, "the vendored source commit must match the shipment lock");
});

test("the protocol pin carries only its owned identity surfaces", () => {
	const pin = readPin();
	assert.deepEqual(Object.keys(pin).sort(), ["non_claims", "schema_version", "shipped", "source", "vendored_path"]);
});

test("the repository root carries exactly the one protocol handoff lock the pin names", () => {
	const pin = readPin();
	const locks = readdirSync(ROOT).filter((name) => /handoff-lock\.json$/u.test(name));
	assert.deepEqual(
		locks.filter((name) => name.includes("protocol")).sort(),
		[pin.shipped.lock_file],
		"a protocol handoff lock the pin does not name is a stale procedure input, not a spare copy",
	);
});

test("the repository's own pin agrees with the lock it was written about", () => {
	const pin = readPin();
	assert.equal(pin.shipped.lock_file, "gateway-protocol-handoff-lock.json");
	assert.equal(pin.shipped.gateway_commit, LOCK.gateway.commit, "the pin must be written about the lock this repository actually carries");
	assert.equal(
		pin.shipped.status === "diverged",
		pin.shipped.protocol_tree !== pin.source.tree,
		"the declared status and the recorded trees must agree",
	);
});
