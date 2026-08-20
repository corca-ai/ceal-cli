import {
	consumerDependencyClosure,
	lockPackages,
	packageFetchIdentity,
	readConsumerClosure,
	UnpinnedDependencyError,
} from "../../scripts/prewarm-offline-consumer-cache.ts";
import assert from "node:assert/strict";
import test from "node:test";

function lockOf(packages: Record<string, Record<string, unknown>>) {
	return { packages };
}

// The committed closure is what the release lane actually prewarms, so a change
// that drops a package from it should be visible here rather than as an
// ENOTCACHED on a cold runner.
test("the committed lockfile yields the real consumer closure", () => {
	const closure = readConsumerClosure();
	const names = closure.map(({ name }) => name);
	assert.deepEqual(names, [...names].sort(), "the closure must be sorted for a stable log");
	for (const required of ["@types/node", "typescript", "yaml", "undici-types"]) {
		assert.ok(names.includes(required), `${required} must stay in the prewarmed closure`);
	}
	assert.ok(
		closure.some(({ name, version }) => name === "typescript" && version === "6.0.3"),
		"an aliased TypeScript package must be fetched by its lockfile-resolved name",
	);
	assert.ok(!names.includes("@typescript/old"), "an npm alias key must never be used as a fetch name");
	// The owned scope is published by this repository's own release, never fetched.
	assert.equal(
		closure.filter(({ name }) => name.startsWith("@corca-ai/")).length,
		0,
		"@corca-ai packages must never be prewarmed from the registry",
	);
	for (const { version } of closure) assert.match(version, /^\d+\.\d+\.\d+/u);
});

// npm installs a matching optional dependency rather than skipping it, so an
// optional transitive missing from the cache fails an --offline install exactly
// like a required one. Nothing in today's closure declares one, which is why
// omitting the field would have gone unnoticed until a new transitive arrived.
test("an optional transitive is prewarmed, not skipped", () => {
	const byName = lockPackages(
		lockOf({
			"": { name: "root" },
			"node_modules/direct": { version: "1.0.0", optionalDependencies: { "optional-child": "^2.0.0" } },
			"node_modules/optional-child": { version: "2.3.4" },
		}),
	);
	const closure = consumerDependencyClosure(byName, [{ dependencies: { direct: "^1.0.0" } }]);
	assert.deepEqual(closure, [
		{ name: "direct", version: "1.0.0" },
		{ name: "optional-child", version: "2.3.4" },
	]);
});

test("a manifest's own optionalDependencies enter the closure", () => {
	const byName = lockPackages(lockOf({ "node_modules/tool": { version: "9.9.9" } }));
	const closure = consumerDependencyClosure(byName, [{ optionalDependencies: { tool: "^9.0.0" } }]);
	assert.deepEqual(closure, [{ name: "tool", version: "9.9.9" }]);
});

// A name can appear at several nested locations with different versions. Keeping
// only the first record cached one version and left the other uncached, so an
// --offline install that resolved the other failed as ENOTCACHED.
test("every pinned version of a colliding name is prewarmed", () => {
	const byName = lockPackages(
		lockOf({
			"node_modules/shared": { version: "1.0.0" },
			"node_modules/a": { version: "1.0.0", dependencies: { shared: "^1.0.0" } },
			"node_modules/a/node_modules/shared": { version: "2.0.0", dependencies: { deep: "^1.0.0" } },
			"node_modules/deep": { version: "3.0.0" },
		}),
	);
	const closure = consumerDependencyClosure(byName, [{ dependencies: { a: "^1.0.0" } }]);
	const shared = closure.filter(({ name }) => name === "shared").map(({ version }) => version);
	assert.deepEqual(shared, ["1.0.0", "2.0.0"], "both pinned versions must be cached");
	// The nested version's own edges must be walked too, or `deep` is missed.
	assert.ok(
		closure.some(({ name }) => name === "deep"),
		"a nested version's transitive must be reached",
	);
});

test("an npm alias uses the lockfile-resolved package identity", () => {
	const byName = lockPackages(
		lockOf({
			"node_modules/alias-name": {
				name: "actual-package",
				version: "2.3.4",
				dependencies: { child: "^1.0.0" },
			},
			"node_modules/child": { version: "1.2.3" },
		}),
	);
	const closure = consumerDependencyClosure(byName, [{ dependencies: { "alias-name": "npm:actual-package@^2" } }]);
	assert.deepEqual(closure, [
		{ name: "actual-package", version: "2.3.4" },
		{ name: "child", version: "1.2.3" },
	]);
	assert.deepEqual(packageFetchIdentity("alias-name", { name: "actual-package", version: "2.3.4" }), {
		name: "actual-package",
		version: "2.3.4",
	});
});

test("an alias to the owned scope is not fetched", () => {
	const byName = lockPackages(
		lockOf({
			"node_modules/external-alias": { name: "@corca-ai/internal", version: "1.2.3" },
		}),
	);
	assert.equal(byName.has("external-alias"), true, "the alias remains indexed so it is not misreported as unpinned");
	assert.deepEqual(consumerDependencyClosure(byName, [{ dependencies: { "external-alias": "npm:@corca-ai/internal@1.2.3" } }]), []);
});

test("peer and dev edges are followed, and the owned scope never is", () => {
	const byName = lockPackages(
		lockOf({
			"node_modules/root-dev": { version: "1.0.0", peerDependencies: { peer: "^1.0.0" } },
			"node_modules/peer": { version: "4.0.0" },
		}),
	);
	const closure = consumerDependencyClosure(byName, [
		{ devDependencies: { "root-dev": "^1.0.0" }, dependencies: { "@corca-ai/ceal-protocol": "0.65.0" } },
	]);
	assert.deepEqual(closure, [
		{ name: "peer", version: "4.0.0" },
		{ name: "root-dev", version: "1.0.0" },
	]);
});

// Caching a package the lockfile does not pin would resolve a range online, which
// is the one thing this script exists to make impossible.
test("an unpinned dependency fails loudly and names every missing package", () => {
	assert.throws(
		() => consumerDependencyClosure(lockPackages(lockOf({})), [{ dependencies: { ghost: "^1.0.0", other: "^2.0.0" } }]),
		(error: unknown) => {
			assert.ok(error instanceof UnpinnedDependencyError);
			assert.deepEqual(error.missing, ["ghost", "other"]);
			return true;
		},
	);
});

test("malformed lock and manifest boundaries fail before traversal", () => {
	assert.throws(
		() => lockPackages({ packages: { "node_modules/broken": { dependencies: {} } } }),
		(error: unknown) => error instanceof TypeError && error.message.includes("must contain a version"),
	);
	assert.throws(
		() => lockPackages({ packages: { "node_modules/broken": { name: 42, version: "1.0.0" } } }),
		(error: unknown) => error instanceof TypeError && error.message.includes("must contain a version"),
	);
	for (const malformed of ["", "../escape", "@broken", "a/b/c", "a\\b", "a b"]) {
		assert.throws(
			() => lockPackages({ packages: { [`node_modules/${malformed}`]: { version: "1.0.0" } } }),
			(error: unknown) => error instanceof TypeError && error.message.includes("valid package name"),
		);
		assert.throws(() => packageFetchIdentity("valid", { name: malformed, version: "1.0.0" }), /valid package name/u);
	}
	assert.throws(
		() => consumerDependencyClosure(lockPackages(lockOf({})), [{ dependencies: ["not-a-map"] }]),
		(error: unknown) => error instanceof TypeError && error.message.includes("must be an object of string ranges"),
	);
});

test("a dependency cycle terminates", () => {
	const byName = lockPackages(
		lockOf({
			"node_modules/left": { version: "1.0.0", dependencies: { right: "^1.0.0" } },
			"node_modules/right": { version: "1.0.0", dependencies: { left: "^1.0.0" } },
		}),
	);
	const closure = consumerDependencyClosure(byName, [{ dependencies: { left: "^1.0.0" } }]);
	assert.deepEqual(closure, [
		{ name: "left", version: "1.0.0" },
		{ name: "right", version: "1.0.0" },
	]);
});
