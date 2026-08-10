export type CealSessionRenewalMode = "observe" | "renew";

// Renewal is a credential-writing decision, so every internal caller must name
// its mode. The runtime check keeps a JavaScript caller or an accidentally
// omitted argument from silently inheriting a write-capable default.
export function requireCealSessionRenewalMode(mode: CealSessionRenewalMode | undefined): CealSessionRenewalMode {
	if (mode === "observe" || mode === "renew") return mode;
	throw new TypeError("An explicit session renewal mode (observe or renew) is required.");
}
