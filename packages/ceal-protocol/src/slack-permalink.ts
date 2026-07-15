const SLACK_HOST = /^[a-z0-9][a-z0-9-]*[.]slack[.]com$/u;
const SLACK_MESSAGE_PATH = /^\/archives\/C[A-Z0-9]{8,}\/p\d{14,}$/u;
const SLACK_CHANNEL = /^C[A-Z0-9]{8,}$/u;
const SLACK_TIMESTAMP = /^\d{10,}[.]\d{4,}$/u;
const ROUTING_QUERY_FIELDS = new Set(["channel", "cid", "message_ts", "thread_ts"]);

/**
 * Accept a user-supplied Slack permalink. Slack's ordinary permalink UI adds
 * routing-only query fields for a thread; those are allowed, while arbitrary,
 * signed, or credential-bearing query fields are not.
 */
export function isCealSlackPermalinkInput(value: unknown): value is string {
	const url = parseBaseSlackPermalink(value);
	if (!url) return false;
	const seen = new Set<string>();
	for (const [key, candidate] of url.searchParams) {
		if (!ROUTING_QUERY_FIELDS.has(key) || seen.has(key) || !isSafeRoutingQueryValue(key, candidate)) return false;
		seen.add(key);
	}
	return true;
}

/** A canonical source citation intentionally contains no query or fragment. */
export function isCealSlackPermalinkSource(value: unknown): value is string {
	const url = parseBaseSlackPermalink(value);
	return url !== null && url.search === "";
}

function parseBaseSlackPermalink(value: unknown): URL | null {
	if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 2048) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== ""
			|| !SLACK_HOST.test(url.hostname) || !SLACK_MESSAGE_PATH.test(url.pathname)) return null;
		return url;
	} catch { return null; }
}

function isSafeRoutingQueryValue(key: string, value: string): boolean {
	return (key === "channel" || key === "cid") ? SLACK_CHANNEL.test(value) : SLACK_TIMESTAMP.test(value);
}
