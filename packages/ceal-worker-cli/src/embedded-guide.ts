import { getRawAsset, isSea } from "node:sea";

// The native builder binds the complete skill directory to this SEA asset.
// Release packaging passes the same name into the SEA config and the native
// smoke executes `guide status`, so a packaging/runtime spelling drift fails
// before publication rather than producing a signed binary with no guide.
const CEAL_EMBEDDED_GUIDE_ASSET = "ceal-guide.tar";

/**
 * Read the guide carried by the signed native binary, without materializing it.
 * `undefined` means this is a normal non-SEA development runtime; `null` means
 * a SEA binary is missing its required canonical directory carrier and must not
 * fall back to the legacy compatibility projection beside it.
 */
export function readEmbeddedCealGuideBundle(): Uint8Array | null | undefined {
	if (!isSea()) return undefined;
	try {
		return new Uint8Array(getRawAsset(CEAL_EMBEDDED_GUIDE_ASSET));
	} catch {
		return null;
	}
}
