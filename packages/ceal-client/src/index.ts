import type { CealGatewayRequestForInput, CealGatewayRequestInput, CealGatewayResponseFor } from "@corca-ai/ceal-protocol";
import { CEAL_PROTOCOL_VERSION } from "@corca-ai/ceal-protocol";
import type { CealClientTransport } from "./http-transport.js";
import { CEAL_SAFE_REF } from "./safe-ref.js";

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
export type {
	CealDeviceAdoptionClient,
	CreateCealDeviceAdoptionClientOptions,
} from "./device-adoption-client.js";
export {
	CealDeviceAdoptionClientError,
	createCealDeviceAdoptionClient,
} from "./device-adoption-client.js";
export type {
	CealEnrollmentClient,
	CreateCealEnrollmentClientOptions,
} from "./enrollment-client.js";
export {
	CealEnrollmentClientError,
	createCealEnrollmentClient,
} from "./enrollment-client.js";
export type {
	CealClientTransport,
	CealHttpResponseEnvelopeKind,
	CealHttpResponseKind,
	CealHttpResponseShapeIssue,
	CealHttpTransportErrorCode,
	CealHttpTransportErrorDetails,
	CreateCealHttpTransportOptions,
} from "./http-transport.js";
export {
	CEAL_DEFAULT_HTTP_TIMEOUT_MS,
	CEAL_GATEWAY_AUDIT_TIMING_ACCEPT_HEADER,
	CEAL_GATEWAY_PROFILES_ACCEPT_HEADER,
	CEAL_GATEWAY_ROUTE_PROVENANCE_ACCEPT_HEADER,
	CealHttpTransportError,
	createCealHttpTransport,
} from "./http-transport.js";
export type {
	CealPersonalClientSessionClient,
	CreateCealPersonalClientSessionClientOptions,
} from "./personal-client-session-client.js";
export {
	CealPersonalClientSessionError,
	createCealPersonalClientSessionClient,
} from "./personal-client-session-client.js";

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
	if (!CEAL_SAFE_REF.test(value)) {
		throw new TypeError("Ceal client request_id must be a non-empty, redaction-safe identifier");
	}
}
