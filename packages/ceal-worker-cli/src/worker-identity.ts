import packageJson from "../package.json" with { type: "json" };
import { CEAL_PROTOCOL_VERSION, CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE } from "@corca-ai/ceal-protocol";

// Read from the manifests their packages already own. The release smoke test
// compares the rendered version against package.json, while the protocol range
// remains owned by the vendored protocol package.
export const CEAL_PACKAGE_VERSION: string = packageJson.version;
export const CEAL_WORKER_PROTOCOL_VERSION = CEAL_PROTOCOL_VERSION;
export const CEAL_WORKER_SUPPORTED_GATEWAY_PROTOCOL_RANGE = CEAL_SUPPORTED_GATEWAY_PROTOCOL_RANGE;
