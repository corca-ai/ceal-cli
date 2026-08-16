import assert from "node:assert/strict";
import test from "node:test";

import {
	CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA,
	decodeCealLeasedConsumerCapabilityCatalog,
} from "../dist/leased-consumer-capability-catalog.js";

const target = (
	digit: string,
	label = "Notion shared workspace",
	connector_kind = "notion",
	target_kind = "workspace",
): Record<string, unknown> => ({
	target_ref: `target:${digit.repeat(64)}`,
	label,
	connector_kind,
	target_kind,
	readiness: "ready",
});
const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	capability_id: "notion.search",
	label: "Search Notion",
	effect: "read",
	target_requirement: "required",
	input_contract: { type: "object", properties: { query: { type: "string" } } },
	evidence_requirement: "provider_result",
	targets: [target("a")],
	...overrides,
});
const catalog = (capabilities: unknown[] = [entry()]): Record<string, unknown> => ({
	schema_version: CEAL_LEASED_CONSUMER_CAPABILITY_CATALOG_SCHEMA,
	capabilities,
});

test("decodes one provider-neutral non-messenger capability catalog", () => {
	const value = catalog([
		entry(),
		entry({ capability_id: "github.issue.get", label: "Read issue", targets: [target("b", "GitHub repository", "github", "repository")] }),
		entry({ capability_id: "collection.search", label: "Search collection", targets: [target("c", "Custom collection", "custom-connector", "drive.folder")] }),
	]);
	assert.equal(decodeCealLeasedConsumerCapabilityCatalog(value), value);
	assert.doesNotMatch(JSON.stringify(value), /message_ref|thread_ref|channel_id|provider_target|grant_ref/u);
});

test("accepts target-free capabilities without inventing a messenger target", () => {
	const value = catalog([entry({ capability_id: "worker.capabilities.list", target_requirement: "none", targets: [] })]);
	assert.equal(decodeCealLeasedConsumerCapabilityCatalog(value), value);
});

test("accepts declared opaque handle arguments without mistaking them for Gateway authority", () => {
	const value = catalog([entry({
		capability_id: "message.delete", label: "Delete governed message", effect: "write",
		input_contract: { schema_version: "ceal.message_delete_input.v1", required: ["message_ref"], message_ref: { type: "string", format: "message_ref" } },
	})]);
	assert.equal(decodeCealLeasedConsumerCapabilityCatalog(value), value);
});

test("declares provider-neutral capability-bound continuation, never a URL target selector", () => {
	const navigation = {
		target_selector: "opaque_catalog_target", url_target_selector: "unsupported",
		required_argument_source: { argument: "ref", handle_kind: "document", issued_by: ["resource.resolve", "notion.search"] },
	};
	const value = catalog([entry({ capability_id: "notion.page.get", navigation })]);
	assert.equal(decodeCealLeasedConsumerCapabilityCatalog(value), value);
	for (const invalid of [
		{ ...navigation, url_target_selector: "supported" },
		{ ...navigation, target_selector: "url_or_opaque" },
		{ ...navigation, required_argument_source: { ...navigation.required_argument_source, issued_by: [] } },
		{ ...navigation, required_argument_source: { ...navigation.required_argument_source, issued_by: ["resource.resolve", "resource.resolve"] } },
		{ ...navigation, required_argument_source: { ...navigation.required_argument_source, handle_kind: "unsafe kind" } },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityCatalog(catalog([entry({ capability_id: "notion.page.get", navigation: invalid })])), TypeError);
	const generic = catalog([entry({ capability_id: "drive.file.get", navigation: { ...navigation, required_argument_source: { argument: "file_ref", handle_kind: "file", issued_by: ["file.search"] } } })]);
	assert.equal(decodeCealLeasedConsumerCapabilityCatalog(generic), generic);
});

test("rejects provider locators, authority fields, duplicate ids, and duplicate target handles", () => {
	for (const value of [
		catalog([entry({ targets: [{ target_ref: "target:notion-page-123", label: "Notion", connector_kind: "notion", target_kind: "workspace" }] })]),
		catalog([entry({ label: "notion:page:abc" })]),
		catalog([entry({ input_contract: { credential: "credential:one" } })]),
		catalog([entry({ input_contract: { properties: { grant_ref: { type: "string" } } } })]),
		catalog([entry({ input_contract: { properties: { query: { type: "string", default: "profile:one" } } } })]),
		catalog([entry(), entry({ targets: [target("b")] })]),
		catalog([entry(), entry({ capability_id: "notion.page.get" })]),
		catalog([entry({ target_requirement: "required", targets: [] })]),
		catalog([entry({ target_requirement: "none" })]),
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityCatalog(value), TypeError);
});

test("rejects undeclared fields instead of tolerating a provider-specific side door", () => {
	for (const value of [
		catalog([{ ...entry(), provider: "notion" }]),
		catalog([{ ...entry(), targets: [{ ...target("a"), page_id: "raw" }] }]),
		catalog([{ ...entry(), targets: [{ ...target("a"), connector_kind: "provider:internal" }] }]),
		catalog([{ ...entry(), targets: [{ ...target("a"), target_kind: "provider:scope" }] }]),
		{ ...catalog(), profile_ref: "profile:one" },
	]) assert.throws(() => decodeCealLeasedConsumerCapabilityCatalog(value), TypeError);
});
