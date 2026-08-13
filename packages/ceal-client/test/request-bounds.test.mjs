import assert from "node:assert/strict";
import test from "node:test";
import { acceptsJsonMediaType } from "../src/request-bounds.ts";

test("JSON media types are exact, parameter-complete, and policy-scoped", () => {
	for (const value of [
		"application/json",
		"Application/JSON",
		"application/json; charset=utf-8",
		'application/json; charset="utf-8"',
		'application/json; charset=utf-8; profile="a;b"',
	]) {
		assert.equal(acceptsJsonMediaType(value), true, value);
		assert.equal(acceptsJsonMediaType(value, true), true, value);
	}

	for (const value of ["application/problem+json", "application/problem+json; charset=utf-8"]) {
		assert.equal(acceptsJsonMediaType(value), false, value);
		assert.equal(acceptsJsonMediaType(value, true), true, value);
	}

	for (const value of [
		null,
		"text/plain",
		"application/jsonp",
		"application/json-seq",
		"text/plain; application/json",
		"application/json; text/plain",
		"application/problem+json; text/plain",
		"application/json; charset",
		"application/json; charset=",
		"application/json, text/plain",
		"application/+json",
	]) {
		assert.equal(acceptsJsonMediaType(value), false, String(value));
		assert.equal(acceptsJsonMediaType(value, true), false, String(value));
	}
});
