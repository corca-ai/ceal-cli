/** Whether an unknown value is a credential-free HTTPS or loopback HTTP endpoint. */
export function isCealSafeEndpoint(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const endpoint = new URL(value);
		const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
		return (
			!endpoint.username &&
			!endpoint.password &&
			!endpoint.search &&
			!endpoint.hash &&
			(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && (host === "127.0.0.1" || host === "::1")))
		);
	} catch {
		return false;
	}
}
