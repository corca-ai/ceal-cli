import { stringify } from "yaml";

interface CealctlIo {
	stdout: { write(chunk: string): unknown };
}

interface CealctlRuntime {
	fetchFn?: typeof globalThis.fetch;
}

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))+$/u;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const PUBLIC_LANDING_HOST = "ceal.borca.ai";

type IngressMode = "direct-origin" | "outbound-tunnel" | "private-network";

interface IngressPlanInput {
	gatewayHost: string;
	org: string;
	instance: string;
	mode: IngressMode;
}

interface IngressOptions extends IngressPlanInput {
	timeoutMs: number;
}

export function ingressHelp(): readonly string[] {
	return [
		"  plan --gateway-host <hostname> --org <slug> --instance <slug> --mode <direct-origin|outbound-tunnel|private-network>",
		"                                 Produce a customer-neutral, no-secret ingress plan. No network or state change.",
		"  verify --gateway-host <hostname> --org <slug> --instance <slug> --mode <direct-origin|outbound-tunnel|private-network> [--timeout-ms <1000..30000>]",
		"                                 Perform one anonymous HTTPS route probe. It never sends credentials or provider requests.",
	];
}

export async function runIngress(options: readonly string[], io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	if (options.length === 0) {
		return write(io, {
			schema_version: "cealctl.ingress.v1", command: "cealctl", status: "needs_input", proof_level: "surface",
			credential_context: "none", network_accessed: false, writes_local_state: false, writes_external: false,
			next_action: "Run 'cealctl ingress --help', then create a plan for one organization-controlled Gateway hostname.",
		});
	}
	if (options[0] === "plan") {
		const input = parseIngressOptions(options.slice(1));
		return input.ok ? write(io, buildIngressPlan(input.value)) : writeError(io, input.error);
	}
	if (options[0] === "verify") {
		const parsed = parseIngressOptions(options.slice(1));
		if (!parsed.ok) return writeError(io, parsed.error);
		return verifyIngress(parsed.value, io, runtime);
	}
	return writeError(io, "Ingress requires the 'plan' or 'verify' subcommand.");
}

function parseIngressOptions(args: readonly string[]): { ok: true; value: IngressOptions } | { ok: false; error: string } {
	const values: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (!["--gateway-host", "--org", "--instance", "--mode", "--timeout-ms"].includes(flag)) return { ok: false, error: `Unknown ingress option: ${flag}` };
		const value = args[index + 1];
		if (!value || value.startsWith("-")) return { ok: false, error: `Ingress option ${flag} requires a value.` };
		values[flag] = value;
		index += 1;
	}
	const gatewayHost = normalizeGatewayHost(values["--gateway-host"]);
	if (!gatewayHost) return { ok: false, error: "--gateway-host must be one organization-controlled DNS hostname, without a scheme or path." };
	if (!SCOPE_PATTERN.test(values["--org"] || "")) return { ok: false, error: "--org must be a lowercase organization slug." };
	if (!SCOPE_PATTERN.test(values["--instance"] || "")) return { ok: false, error: "--instance must be a lowercase instance slug." };
	if (!isIngressMode(values["--mode"])) return { ok: false, error: "--mode must be direct-origin, outbound-tunnel, or private-network." };
	const timeoutMs = values["--timeout-ms"] ? Number(values["--timeout-ms"]) : 10_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) return { ok: false, error: "--timeout-ms must be an integer between 1000 and 30000." };
	return {
		ok: true,
		value: { gatewayHost, org: values["--org"], instance: values["--instance"], mode: values["--mode"], timeoutMs },
	};
}

function normalizeGatewayHost(value: string | undefined): string | null {
	const host = String(value || "").trim().toLowerCase().replace(/\.+$/u, "");
	if (!HOST_PATTERN.test(host) || host === PUBLIC_LANDING_HOST || host.endsWith(`.${PUBLIC_LANDING_HOST}`)) return null;
	return host;
}

function isIngressMode(value: string | undefined): value is IngressMode {
	return value === "direct-origin" || value === "outbound-tunnel" || value === "private-network";
}

export function buildIngressPlan(input: IngressPlanInput) {
	const origin = `https://${input.gatewayHost}/${input.org}/${input.instance}`;
	return {
		schema_version: "cealctl.ingress_plan.v1",
		command: "cealctl",
		status: "planned",
		proof_level: "plan",
		credential_context: "none",
		gateway_control_origin: origin,
		personal_client_endpoint: `${origin}/api/ceal/v1`,
		mode: input.mode,
		writes_local_state: false,
		writes_external: false,
		network_accessed: false,
		customer_owned_steps: customerOwnedSteps(input.mode, input.gatewayHost),
		gateway_host_steps: [
			"Keep Ceal backends loopback-only; expose only an ingress proxy or selected private route.",
			"Terminate or pass through TLS according to the chosen ingress, then forward the validated host to the Gateway front router.",
			"Set the same hostname when provisioning the Gateway control origin; do not use ceal.borca.ai.",
		],
		verification: {
			command: `cealctl ingress verify --gateway-host ${input.gatewayHost} --org ${input.org} --instance ${input.instance} --mode ${input.mode}`,
			probe_url: `${origin}/api/ceal/v1`,
			success_definition: "Any TLS-valid HTTP response proves only that the selected network path reached an HTTPS responder. Gateway route and identity remain unverified until the later authenticated Gateway readback.",
			non_claims: ["DNS ownership is not verified by the plan.", "The plan does not apply DNS, tunnel, firewall, reverse-proxy, or Gateway configuration.", "A transport response, including an edge 401/403, does not prove the Gateway route, authenticated session, connector readiness, or provider action."],
		},
	};
}

function customerOwnedSteps(mode: IngressMode, gatewayHost: string): readonly string[] {
	if (mode === "direct-origin") return [
		`Create customer-controlled DNS for ${gatewayHost} to the Gateway ingress address.`,
		"Permit only the required HTTPS ingress; keep the Gateway front-router port private behind the reverse proxy.",
		"Configure a valid certificate and reverse proxy with the chosen hostname preserved.",
	];
	if (mode === "outbound-tunnel") return [
		`Create a customer-controlled private-app/tunnel hostname for ${gatewayHost}.`,
		"Run the chosen tunnel connector from the Gateway environment; do not place connector or provider credentials in Ceal clients.",
		"Bind the edge access policy separately from Ceal authentication, then preserve the hostname to the Gateway.",
	];
	return [
		`Publish ${gatewayHost} only through the customer VPN, private DNS, or Zero-Trust route.`,
		"Authorize client network access before Ceal enrollment; do not substitute a public landing hostname.",
		"Provide TLS and a hostname-preserving route to the Gateway ingress proxy.",
	];
}

async function verifyIngress(input: IngressOptions, io: CealctlIo, runtime: CealctlRuntime): Promise<number> {
	const plan = buildIngressPlan(input);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs);
	try {
		const response = await (runtime.fetchFn ?? globalThis.fetch)(plan.verification.probe_url, {
			method: "GET",
			redirect: "error",
			signal: controller.signal,
			headers: { accept: "application/json" },
		});
		const routeStatus = "transport_reachable";
		return write(io, {
			schema_version: "cealctl.ingress_verify.v1", command: "cealctl", status: routeStatus,
			proof_level: "transport", credential_context: "none", mode: input.mode,
			gateway_control_origin: plan.gateway_control_origin, probe_url: plan.verification.probe_url,
			http_status: response.status, network_accessed: true, writes_local_state: false, writes_external: false,
			raw_response_body_visible: false,
			gateway_route_verified: false,
			next_action: "Provision the same control origin on the Gateway only after confirming this is the intended customer ingress, then obtain an authenticated Gateway readback. Do not treat this response as Gateway identity proof.",
		});
	} catch {
		return write(io, {
			schema_version: "cealctl.ingress_verify.v1", command: "cealctl", status: "unreachable",
			proof_level: "transport", credential_context: "none", mode: input.mode,
			gateway_control_origin: plan.gateway_control_origin, probe_url: plan.verification.probe_url,
			network_accessed: true, writes_local_state: false, writes_external: false, raw_response_body_visible: false,
			next_action: "Inspect the customer network path, DNS, TLS certificate, edge policy, and Gateway ingress proxy, then retry once.",
		});
	} finally {
		clearTimeout(timer);
	}
}

function write(io: CealctlIo, payload: unknown): 0 {
	io.stdout.write(stringify(payload, { aliasDuplicateObjects: false, lineWidth: 0 }));
	return 0;
}

function writeError(io: CealctlIo, message: string): 2 {
	write(io, {
		schema_version: "cealctl.ingress_error.v1", command: "cealctl", ok: false, status: "error",
		credential_context: "none", error: { kind: "invalid_argument", message, next_action: "Run 'cealctl ingress --help'." },
	});
	return 2;
}
