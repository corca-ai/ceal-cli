import { CEAL_PROTOCOL_VERSION } from "@corca-ai/ceal-protocol";
import type {
	CealGatewayRequestForInput,
	CealGatewayRequestInput,
	CealGatewayResponseFor,
} from "@corca-ai/ceal-protocol";
import type { CealClientTransport } from "./http-transport.js";

export {
	CEAL_GATEWAY_PROFILES_ACCEPT_HEADER,
	CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER,
	CealHttpTransportError,
	createCealHttpTransport,
} from "./http-transport.js";
export {
	CealEnrollmentClientError,
	createCealEnrollmentClient,
} from "./enrollment-client.js";
export type {
	CealEnrollmentClient,
	CreateCealEnrollmentClientOptions,
} from "./enrollment-client.js";
export {
	CealPersonalClientSessionError,
	createCealPersonalClientSessionClient,
} from "./personal-client-session-client.js";
export type {
	CealPersonalClientSessionClient,
	CreateCealPersonalClientSessionClientOptions,
} from "./personal-client-session-client.js";
export type {
	CealClientTransport,
	CealHttpTransportErrorCode,
	CreateCealHttpTransportOptions,
} from "./http-transport.js";

export type {
	CealClientFailure,
	CealClientOperation,
	CealClientRequest,
	CealClientResponse,
	CealClientSuccess,
	CealGatewayRequest,
	CealGatewayRequestForInput,
	CealGatewayRequestInput,
	CealGatewayResponseFor,
	CealProofReferenceOrUnavailable,
	CealProofUnavailable,
} from "@corca-ai/ceal-protocol";

export interface CealClient {
	request<I extends CealGatewayRequestInput>(input: Readonly<I>): Promise<CealGatewayResponseFor<CealGatewayRequestForInput<I>>>;
}

export function createCealClient(transport: CealClientTransport): CealClient {
	return {
		async request<I extends CealGatewayRequestInput>(input: Readonly<I>): Promise<CealGatewayResponseFor<CealGatewayRequestForInput<I>>> {
			assertRequestId(input.request_id);
			const request = { ...input, protocol_version: CEAL_PROTOCOL_VERSION } as unknown as CealGatewayRequestForInput<I>;
			return transport.send<CealGatewayRequestForInput<I>>(request);
		},
	};
}

function assertRequestId(value: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError("Ceal client request_id must be a non-empty, redaction-safe identifier");
	}
}
