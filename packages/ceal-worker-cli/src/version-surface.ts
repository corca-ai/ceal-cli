import type { CealCliIo } from "./cli-runtime.js";
import { CEAL_CREDENTIAL_CONTEXT } from "./command-definitions.js";
import { writeYaml } from "./output.js";
import { CEAL_PACKAGE_VERSION, CEAL_WORKER_PROTOCOL_VERSION, CEAL_WORKER_SUPPORTED_GATEWAY_PROTOCOL_RANGE } from "./worker-identity.js";

export function writeVersion(io: CealCliIo): number {
	return writeYaml(io.stdout, {
		schema_version: "ceal.version.v1",
		command: "ceal",
		version: CEAL_PACKAGE_VERSION,
		protocol_version: CEAL_WORKER_PROTOCOL_VERSION,
		supported_gateway_protocol_range: CEAL_WORKER_SUPPORTED_GATEWAY_PROTOCOL_RANGE,
		credential_context: CEAL_CREDENTIAL_CONTEXT,
	});
}
