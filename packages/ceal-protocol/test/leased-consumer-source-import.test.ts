import assert from "node:assert/strict";
import test from "node:test";

import {
	CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA,
	decodeCealLeasedConsumerCommentCreateArguments,
	validCealLeasedConsumerCommentCreateData,
} from "../src/leased-consumer-comment.ts";
import {
	CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA,
	decodeCealLeasedConsumerGithubIssueCreateArguments,
	decodeCealLeasedConsumerGithubIssueGetArguments,
	decodeCealLeasedConsumerGithubPullRequestGetArguments,
	validCealLeasedConsumerGithubIssueCreateData,
} from "../src/leased-consumer-github.ts";
import {
	CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_READ_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA,
	CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_READ_DATA_SCHEMA,
	decodeCealLeasedConsumerCalendarAvailabilityArguments,
	decodeCealLeasedConsumerCalendarEventGetArguments,
	decodeCealLeasedConsumerCalendarEventSearchArguments,
	decodeCealLeasedConsumerCollectionSearchArguments,
	decodeCealLeasedConsumerGithubRepositoryGetArguments,
	decodeCealLeasedConsumerGithubWorkflowRunGetArguments,
	validCealLeasedConsumerCalendarAvailabilityData,
	validCealLeasedConsumerCalendarEventGetData,
	validCealLeasedConsumerCalendarEventSearchData,
	validCealLeasedConsumerCollectionSearchData,
	validCealLeasedConsumerGithubRepositoryReadData,
	validCealLeasedConsumerGithubWorkflowRunReadData,
} from "../src/leased-consumer-provider-reads.ts";

const ref = `document:${"a".repeat(64)}`;
const iso = "2026-08-17T00:00:00Z";
const later = "2026-08-18T00:00:00Z";
const throwsInvalid = (decoder: (value: unknown) => void, values: unknown[]): void => {
	for (const value of values) assert.throws(() => decoder(value), TypeError);
};

test("comment and GitHub source imports enforce exact keys, bounded text, and terminal data", () => {
	const comment = { schema_version: CEAL_LEASED_CONSUMER_COMMENT_CREATE_ARGUMENTS_SCHEMA, ref, text: "A useful comment" };
	assert.doesNotThrow(() => decodeCealLeasedConsumerCommentCreateArguments(comment));
	throwsInvalid(decodeCealLeasedConsumerCommentCreateArguments, [
		{ ...comment, extra: true }, { ...comment, ref: "https://github.com/org/repo/issues/1" },
		{ ...comment, text: "" }, { ...comment, text: "line\nbreak" }, { ...comment, text: "😀".repeat(3_000) },
		{ ...comment, schema_version: "wrong" },
	]);
	for (const terminal of ["readback_confirmed", "idempotency_replayed"]) {
		assert.equal(validCealLeasedConsumerCommentCreateData({ schema_version: CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA, terminal }), true);
	}
	assert.equal(validCealLeasedConsumerCommentCreateData({ schema_version: CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA, terminal: "unknown" }), false);
	assert.equal(validCealLeasedConsumerCommentCreateData({ schema_version: CEAL_LEASED_CONSUMER_COMMENT_CREATE_DATA_SCHEMA, terminal: "readback_confirmed", extra: true }), false);

	const issueGet = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_ISSUE_GET_ARGUMENTS_SCHEMA, ref };
	const pullGet = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_PULL_REQUEST_GET_ARGUMENTS_SCHEMA, ref };
	assert.doesNotThrow(() => decodeCealLeasedConsumerGithubIssueGetArguments(issueGet));
	assert.doesNotThrow(() => decodeCealLeasedConsumerGithubPullRequestGetArguments(pullGet));
	throwsInvalid(decodeCealLeasedConsumerGithubIssueGetArguments, [{ ...issueGet, extra: true }, { ...issueGet, ref: "issue:1" }]);
	throwsInvalid(decodeCealLeasedConsumerGithubPullRequestGetArguments, [{ ...pullGet, schema_version: issueGet.schema_version }, { ...pullGet, ref: "" }]);

	const issue = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_ARGUMENTS_SCHEMA, title: "Bug", body: "Details", labels: ["bug", "triage"], idempotency_key: "issue-create:1" };
	assert.doesNotThrow(() => decodeCealLeasedConsumerGithubIssueCreateArguments(issue));
	throwsInvalid(decodeCealLeasedConsumerGithubIssueCreateArguments, [
		{ ...issue, labels: ["Bug", "bug"] }, { ...issue, labels: ["bug".repeat(129)] },
		{ ...issue, idempotency_key: "-bad" }, { ...issue, title: "\u0000bad" },
		{ ...issue, title: "x".repeat(4_100), body: "y".repeat(4_100) }, { ...issue, extra: true },
	]);
	for (const terminal of ["readback_confirmed", "idempotency_replayed"]) assert.equal(validCealLeasedConsumerGithubIssueCreateData({ schema_version: CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA, terminal }), true);
	assert.equal(validCealLeasedConsumerGithubIssueCreateData({ schema_version: CEAL_LEASED_CONSUMER_GITHUB_ISSUE_CREATE_DATA_SCHEMA, terminal: "nope" }), false);
});

test("provider-read argument decoders enforce references, pagination, windows, and time zones", () => {
	const repository = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_GET_ARGUMENTS_SCHEMA, ref };
	const workflow = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_GET_ARGUMENTS_SCHEMA, run_id: 42 };
	const collection = { schema_version: CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_ARGUMENTS_SCHEMA, query: "roadmap", limit: 10, offset: 0 };
	const availability = { schema_version: CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_ARGUMENTS_SCHEMA, time_min: iso, time_max: later, time_zone: "Asia/Seoul" };
	const eventSearch = { schema_version: CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_ARGUMENTS_SCHEMA, time_min: iso, time_max: later, query: "planning", limit: 5, time_zone: "UTC" };
	const eventGet = { schema_version: CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_ARGUMENTS_SCHEMA, ref };
	for (const [decoder, value] of [[decodeCealLeasedConsumerGithubRepositoryGetArguments, repository], [decodeCealLeasedConsumerGithubWorkflowRunGetArguments, workflow], [decodeCealLeasedConsumerCollectionSearchArguments, collection], [decodeCealLeasedConsumerCalendarAvailabilityArguments, availability], [decodeCealLeasedConsumerCalendarEventSearchArguments, eventSearch], [decodeCealLeasedConsumerCalendarEventGetArguments, eventGet]] as const) assert.doesNotThrow(() => decoder(value));
	throwsInvalid(decodeCealLeasedConsumerGithubRepositoryGetArguments, [{ ...repository, ref: "repo:bad" }, { ...repository, extra: 1 }]);
	throwsInvalid(decodeCealLeasedConsumerGithubWorkflowRunGetArguments, [{ ...workflow, run_id: 0 }, { ...workflow, run_id: 1.5 }]);
	throwsInvalid(decodeCealLeasedConsumerCollectionSearchArguments, [{ ...collection, query: "   " }, { ...collection, limit: 33 }, { ...collection, offset: 91 }, { ...collection, limit: 0 }]);
	throwsInvalid(decodeCealLeasedConsumerCalendarAvailabilityArguments, [{ ...availability, time_max: iso }, { ...availability, time_zone: "Mars/Olympus" }, { ...availability, time_min: "not-a-date" }]);
	throwsInvalid(decodeCealLeasedConsumerCalendarEventSearchArguments, [{ ...eventSearch, limit: 26 }, { ...eventSearch, query: "\u0001" }, { ...eventSearch, time_zone: "" }, { ...eventSearch, time_min: later }]);
	throwsInvalid(decodeCealLeasedConsumerCalendarEventGetArguments, [{ ...eventGet, ref: "message:bad" }]);
});

const repositoryData = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_REPOSITORY_READ_DATA_SCHEMA, repository: { archived: false, fork: false, name: "ceal", topics: ["typescript"], description: "runtime", default_branch: "main", visibility: "public" } };
const workflowData = { schema_version: CEAL_LEASED_CONSUMER_GITHUB_WORKFLOW_RUN_READ_DATA_SCHEMA, workflow_run: { run_id: 42, name: "CI", display_title: "Build", event: "push", status: "completed", conclusion: "success", head_branch: "main", head_sha_short: "abcdef1", run_number: 4, run_attempt: 1, created_at: iso, updated_at: later } };
const coverage = { completeness: "complete", truncated: false };
const collectionItem = { display_name: "Result", handle_index: 0, description_preview: "preview", updated_at: iso, visibility: "public" };
const calendarItem = { display_name: "Meeting", handle_index: 0, start: iso, end: later, summary: "Agenda", status: "confirmed" };

test("provider-read result validators enforce nested data shapes and bounded pages", () => {
	assert.equal(validCealLeasedConsumerGithubRepositoryReadData(repositoryData), true);
	assert.equal(validCealLeasedConsumerGithubWorkflowRunReadData(workflowData), true);
	assert.equal(validCealLeasedConsumerGithubRepositoryReadData({ ...repositoryData, repository: { ...repositoryData.repository, topics: ["x".repeat(81)] } }), false);
	assert.equal(validCealLeasedConsumerGithubWorkflowRunReadData({ ...workflowData, workflow_run: { ...workflowData.workflow_run, run_id: 0 } }), false);

	const collectionData = { schema_version: CEAL_LEASED_CONSUMER_COLLECTION_SEARCH_DATA_SCHEMA, query: { redacted: true, utf8_bytes: 7 }, coverage, offset: 0, result_count: 1, results: [collectionItem] };
	assert.equal(validCealLeasedConsumerCollectionSearchData(collectionData), true);
	for (const invalid of [
		{ ...collectionData, result_count: 2 }, { ...collectionData, coverage: { ...coverage, completeness: "partial" } },
		{ ...collectionData, query: { redacted: false, utf8_bytes: 7 } }, { ...collectionData, offset: 91 },
		{ ...collectionData, results: [{ ...collectionItem, handle_index: 32 }] },
	]) assert.equal(validCealLeasedConsumerCollectionSearchData(invalid), false);

	const availabilityData = { schema_version: CEAL_LEASED_CONSUMER_CALENDAR_AVAILABILITY_DATA_SCHEMA, time_min: iso, time_max: later, partial: false, busy_periods: [{ start: iso, end: later }] };
	assert.equal(validCealLeasedConsumerCalendarAvailabilityData(availabilityData), true);
	for (const invalid of [
		{ ...availabilityData, time_max: "not-a-date" }, { ...availabilityData, partial: "false" },
		{ ...availabilityData, busy_periods: [{ start: later, end: iso }] },
		{ ...availabilityData, busy_periods: Array.from({ length: 101 }, () => ({ start: iso, end: later })) },
	]) assert.equal(validCealLeasedConsumerCalendarAvailabilityData(invalid), false);

	const eventSearchData = { schema_version: CEAL_LEASED_CONSUMER_CALENDAR_EVENT_SEARCH_DATA_SCHEMA, time_min: iso, time_max: later, query: { redacted: true, utf8_bytes: 3 }, coverage, result_count: 1, results: [calendarItem] };
	assert.equal(validCealLeasedConsumerCalendarEventSearchData(eventSearchData), true);
	assert.equal(validCealLeasedConsumerCalendarEventSearchData({ ...eventSearchData, results: [{ ...calendarItem, end: "not-a-date" }] }), false);
	assert.equal(validCealLeasedConsumerCalendarEventSearchData({ ...eventSearchData, result_count: 26 }), false);

	const eventGetData = { schema_version: CEAL_LEASED_CONSUMER_CALENDAR_EVENT_GET_DATA_SCHEMA, start: iso, end: later, summary: "Agenda", status: "confirmed" };
	assert.equal(validCealLeasedConsumerCalendarEventGetData(eventGetData), true);
	assert.equal(validCealLeasedConsumerCalendarEventGetData({ ...eventGetData, extra: true }), false);
	assert.equal(validCealLeasedConsumerCalendarEventGetData({ ...eventGetData, start: "tomorrow" }), false);
});
