import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type CealAgentGuideHost = "codex" | "claude";

// One declaration per supported agent host: the environment override, the
// default root under HOME, and the human label its errors name. Adding a host
// means adding a row here plus its `guide register <host>` route — the state
// projection, conflict handling, and status readback derive from this table.
const CEAL_AGENT_GUIDE_HOSTS: readonly {
	agent: CealAgentGuideHost;
	label: string;
	defaultRoot: string;
	environmentVariable: string;
}[] = [
	{ agent: "codex", label: "Codex", defaultRoot: ".codex", environmentVariable: "CODEX_HOME" },
	{ agent: "claude", label: "Claude Code", defaultRoot: ".claude", environmentVariable: "CLAUDE_CONFIG_DIR" },
];

export interface CealAgentGuideHostState {
	agent: CealAgentGuideHost;
	status: "registered" | "staged";
	registration_path: string;
	registered: boolean;
}

export interface CealAgentGuideState {
	status: "registered" | "staged" | "unavailable";
	agent: CealAgentGuideHost;
	guide_id: "ceal-guide";
	guide_path?: string;
	registration_path?: string;
	update_safe: boolean;
	registered: boolean;
	// Additive per-host projection: `agent` and the sibling fields keep naming one
	// host so a Codex-only reader of `ceal.guide.v1` is unaffected, while a reader
	// that knows more than one host reads every registration from `hosts`.
	hosts?: readonly CealAgentGuideHostState[];
	error?: {
		kind: "guide_unavailable" | "registration_conflict" | "registration_failed";
		message: string;
		next_action: string;
	};
}

export interface CealAgentGuideStore {
	inspect(agent?: CealAgentGuideHost): CealAgentGuideState;
	register(agent?: CealAgentGuideHost): CealAgentGuideState;
}

export function createCealAgentGuideStore(
	executablePath: string,
	homeDirectory: string | undefined,
	codexHomeDirectory: string | undefined,
	claudeConfigDirectory?: string | undefined,
): CealAgentGuideStore | undefined {
	const overrides: Record<CealAgentGuideHost, string | undefined> = {
		codex: codexHomeDirectory,
		claude: claudeConfigDirectory,
	};
	const registrationPaths = new Map<CealAgentGuideHost, string>();
	for (const host of CEAL_AGENT_GUIDE_HOSTS) {
		const root = overrides[host.agent] ?? (homeDirectory ? join(homeDirectory, host.defaultRoot) : undefined);
		if (root) registrationPaths.set(host.agent, join(root, "skills", "ceal-guide"));
	}
	if (registrationPaths.size === 0) return undefined;
	const defaultAgent = [...registrationPaths.keys()][0]!;
	let guidePath: string;
	try {
		const releaseDirectory = dirname(realpathSync(executablePath));
		guidePath = resolve(releaseDirectory, "..", "..", "current", "guide");
		assertGuideAvailable(guidePath);
	} catch {
		return unavailableStore(defaultAgent);
	}
	const resolveAgent = (agent: CealAgentGuideHost | undefined): CealAgentGuideHost => agent ?? defaultAgent;
	return {
		inspect: (agent) => {
			const target = resolveAgent(agent);
			const registrationPath = registrationPaths.get(target);
			if (!registrationPath) return hostUnresolvedState(target, guidePath);
			return inspectRegistration(guidePath, target, registrationPath, registrationPaths);
		},
		register: (agent) => {
			const target = resolveAgent(agent);
			const registrationPath = registrationPaths.get(target);
			if (!registrationPath) return hostUnresolvedState(target, guidePath);
			return registerGuide(guidePath, target, registrationPath, registrationPaths);
		},
	};
}

function labelOf(agent: CealAgentGuideHost): string {
	return CEAL_AGENT_GUIDE_HOSTS.find((host) => host.agent === agent)!.label;
}

function environmentVariableOf(agent: CealAgentGuideHost): string {
	return CEAL_AGENT_GUIDE_HOSTS.find((host) => host.agent === agent)!.environmentVariable;
}

function unavailableStore(agent: CealAgentGuideHost): CealAgentGuideStore {
	const state = unavailableState(agent);
	return { inspect: () => state, register: () => state };
}

function unavailableState(agent: CealAgentGuideHost): CealAgentGuideState {
	return {
		status: "unavailable",
		agent,
		guide_id: "ceal-guide",
		update_safe: false,
		registered: false,
		error: {
			kind: "guide_unavailable",
			message: "The signed Ceal guide is not available beside this installed binary.",
			next_action: "Reinstall a signed Ceal worker release, then run 'ceal guide status'.",
		},
	};
}

// The guide asset is fine but this host's configuration root cannot be located,
// so the honest answer names the variable that would resolve it rather than
// claiming a registration path the command never inspected.
function hostUnresolvedState(agent: CealAgentGuideHost, guidePath: string): CealAgentGuideState {
	return {
		status: "unavailable",
		agent,
		guide_id: "ceal-guide",
		guide_path: guidePath,
		update_safe: false,
		registered: false,
		error: {
			kind: "registration_failed",
			message: `The ${labelOf(agent)} configuration directory could not be resolved for this command runtime.`,
			next_action: `Set HOME or ${environmentVariableOf(agent)}, then run 'ceal guide status'.`,
		},
	};
}

function assertGuideAvailable(guidePath: string): void {
	const skillPath = join(guidePath, "SKILL.md");
	if (!existsSync(skillPath) || !lstatSync(skillPath).isFile()) throw new Error("guide_unavailable");
}

function inspectRegistration(
	guidePath: string,
	agent: CealAgentGuideHost,
	registrationPath: string,
	registrationPaths: ReadonlyMap<CealAgentGuideHost, string>,
): CealAgentGuideState {
	const registered = registrationMatches(guidePath, registrationPath);
	return {
		status: registered ? "registered" : "staged",
		agent,
		guide_id: "ceal-guide",
		guide_path: guidePath,
		registration_path: registrationPath,
		update_safe: true,
		registered,
		hosts: [...registrationPaths].map(([hostAgent, hostPath]) => {
			const hostRegistered = registrationMatches(guidePath, hostPath);
			return {
				agent: hostAgent,
				status: hostRegistered ? "registered" : "staged",
				registration_path: hostPath,
				registered: hostRegistered,
			} satisfies CealAgentGuideHostState;
		}),
	};
}

function registerGuide(
	guidePath: string,
	agent: CealAgentGuideHost,
	registrationPath: string,
	registrationPaths: ReadonlyMap<CealAgentGuideHost, string>,
): CealAgentGuideState {
	try {
		if (existsSync(registrationPath) || isDanglingSymlink(registrationPath)) {
			if (registrationMatches(guidePath, registrationPath)) return inspectRegistration(guidePath, agent, registrationPath, registrationPaths);
			return conflictState(guidePath, agent, registrationPath, registrationPaths);
		}
		mkdirSync(dirname(registrationPath), { recursive: true, mode: 0o700 });
		symlinkSync(guidePath, registrationPath, "dir");
		return inspectRegistration(guidePath, agent, registrationPath, registrationPaths);
	} catch {
		return {
			...inspectRegistration(guidePath, agent, registrationPath, registrationPaths),
			status: "unavailable",
			registered: false,
			error: {
				kind: "registration_failed",
				message: `The Ceal guide could not be registered with ${labelOf(agent)}.`,
				next_action: "Inspect the reported registration path and retry without replacing an existing skill directory.",
			},
		};
	}
}

function conflictState(
	guidePath: string,
	agent: CealAgentGuideHost,
	registrationPath: string,
	registrationPaths: ReadonlyMap<CealAgentGuideHost, string>,
): CealAgentGuideState {
	return {
		...inspectRegistration(guidePath, agent, registrationPath, registrationPaths),
		status: "unavailable",
		registered: false,
		error: {
			kind: "registration_conflict",
			message: `The ${labelOf(agent)} ceal-guide path already contains an unmanaged file, directory, or link.`,
			next_action: "Inspect the existing registration path and replace it deliberately before retrying.",
		},
	};
}

function registrationMatches(guidePath: string, registrationPath: string): boolean {
	try {
		if (!lstatSync(registrationPath).isSymbolicLink()) return false;
		const link = readlinkSync(registrationPath);
		const resolvedLink = isAbsolute(link) ? link : resolve(dirname(registrationPath), link);
		return realpathSync(resolvedLink) === realpathSync(guidePath);
	} catch {
		return false;
	}
}

function isDanglingSymlink(path: string): boolean {
	try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}
