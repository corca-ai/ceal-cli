import {
	CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_HANDLE_LIMIT,
	CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA,
	CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA,
	CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA,
} from "./leased-consumer-control-schemas.ts";
import { validCealLeasedConsumerMessageAuthor } from "./leased-consumer-message-author.ts";
import { CEAL_LEASED_CONSUMER_READ_ITEM_KINDS, validCealLeasedConsumerReadItemDetail } from "./leased-consumer-directory-reads.ts";
import { validCealLeasedConsumerMessageSearchContinuation } from "./leased-consumer-search-arguments.ts";
import { opaqueTargetRef } from "./leased-consumer-opaque-refs.ts";

type ResourceReadItemValidator = (value: unknown, handleCount: number) => boolean;
type ReplyTextValidator = (value: unknown) => boolean;
type BoundedTextValidator = (value: unknown, maximum: number) => boolean;

/** Resource items keep the key set beside the published detail vocabulary. */
export function validCealLeasedConsumerResourceReadItem(value: unknown, handleCount: number, safeReplyText: ReplyTextValidator, safeText: BoundedTextValidator): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["actor_kind", "author", "display_name", "filename", "handle_index", "kind", "mimetype", "reply_count", "size_bytes", "subject_ref", "text"], ["actor_kind", "author", "filename", "handle_index", "mimetype", "reply_count", "size_bytes", "subject_ref", "text"]);
	return (CEAL_LEASED_CONSUMER_READ_ITEM_KINDS as readonly string[]).includes(value.kind as string)
		&& typeof value.display_name === "string" && value.display_name.length >= 1 && safeText(value.display_name, 512)
		&& validCealLeasedConsumerReadItemDetail(value, handleCount, safeReplyText, validCealLeasedConsumerMessageAuthor);
}

export function decodeCealLeasedConsumerResourceReadData(value: unknown, handles: readonly unknown[], resourceReadItem: ResourceReadItemValidator): boolean {
	if (!plainRecord(value)) return false;
	requireExactKeys(value, ["items", "schema_version", "truncated"], ["truncated"]);
	if (value.schema_version !== CEAL_LEASED_CONSUMER_RESOURCE_READ_DATA_SCHEMA || !Array.isArray(value.items) || value.items.length > 64 || (value.truncated !== undefined && typeof value.truncated !== "boolean")) return false;
	return value.items.every((item) => resourceReadItem(item, handles.length));
}

export function decodeCealLeasedConsumerMessageSearchData(value: unknown, handles: readonly unknown[], resourceReadItem: ResourceReadItemValidator): boolean {
	if (!plainRecord(value) || value.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_DATA_SCHEMA) return false;
	requireExactKeys(value, ["completeness", "items", "next_action", "schema_version"], ["next_action"]);
	if (!Array.isArray(value.items) || value.items.length > CEAL_LEASED_CONSUMER_CAPABILITY_RESULT_HANDLE_LIMIT || !value.items.every((item) => resourceReadItem(item, handles.length))) invalid();
	if (value.completeness === "complete") {
		if (value.next_action !== undefined) invalid();
		return true;
	}
	if (value.completeness !== "continuation_available") invalid();
	decodeMessageSearchNextAction(value.next_action);
	return true;

	function decodeMessageSearchNextAction(nextAction: unknown): void {
		if (!plainRecord(nextAction)) invalid();
		requireExactKeys(nextAction, ["arguments", "capability_id", "target_ref"]);
		if (nextAction.capability_id !== "message.search" || !opaqueTargetRef(nextAction.target_ref)) invalid();
		if (!plainRecord(nextAction.arguments)) invalid();
		requireExactKeys(nextAction.arguments, ["continuation", "schema_version"]);
		if (nextAction.arguments.schema_version !== CEAL_LEASED_CONSUMER_MESSAGE_SEARCH_ARGUMENTS_V2_SCHEMA || !validCealLeasedConsumerMessageSearchContinuation(nextAction.arguments.continuation)) invalid();
	}
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], optional: readonly string[] = []): void {
	const keys = Object.keys(value).sort();
	const allowed = [...expected].sort();
	const required = allowed.filter((key) => !optional.includes(key));
	if (keys.length < required.length || keys.length > allowed.length || !keys.every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(value, key))) invalid();
}
function plainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function invalid(): never { throw new TypeError("Ceal leased-consumer control record is invalid"); }
