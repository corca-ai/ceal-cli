import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type CealAgentGuideHost = "codex" | "claude";

// One declaration per supported agent host: the environment override, the
// default root under HOME, and the human label its errors name. Adding a host
// means adding a row here plus its `guide register <host>` route — the state
// projection, conflict handling, and status readback derive from this table.
// The first row is the default projection for a host-less `guide status`, which
// is what keeps `ceal.guide.v1`'s top-level fields meaning the same host they
// have always meant.
const CEAL_AGENT_GUIDE_HOSTS: readonly {
	agent: CealAgentGuideHost;
	label: string;
	defaultRoot: string;
	environmentVariable: string;
}[] = [
	{ agent: "codex", label: "Codex", defaultRoot: ".codex", environmentVariable: "CODEX_HOME" },
	{ agent: "claude", label: "Claude Code", defaultRoot: ".claude", environmentVariable: "CLAUDE_CONFIG_DIR" },
];

const DEFAULT_AGENT_GUIDE_HOST = CEAL_AGENT_GUIDE_HOSTS[0]!.agent;

export function isCealAgentGuideHost(value: string | undefined): value is CealAgentGuideHost {
	return CEAL_AGENT_GUIDE_HOSTS.some((host) => host.agent === value);
}

export interface CealAgentGuideHostState {
	agent: CealAgentGuideHost;
	// `unresolved` is a configuration answer, not a registration answer: the host
	// is supported and its route is advertised, but no directory was located, so
	// this entry deliberately carries no registration_path.
	status: "registered" | "staged" | "unavailable" | "unresolved";
	registration_path?: string;
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
	// Additive per-host projection: `agent` and the sibling fields keep naming the
	// default host so a Codex-only reader of `ceal.guide.v1` is unaffected, while a
	// reader that knows more than one host reads every advertised host from
	// `hosts` — including the ones whose directory could not be resolved.
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

interface ResolvedGuideHost {
	registrationPath?: string;
	rejectedOverride: boolean;
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
	const resolved = new Map<CealAgentGuideHost, ResolvedGuideHost>();
	for (const host of CEAL_AGENT_GUIDE_HOSTS) {
		// An empty override is no override; a relative or list-shaped one is a
		// refusal, never a guess: `join`ing it would create a skill tree under the
		// current working directory and then report it as a real registration.
		const raw = overrides[host.agent] || (homeDirectory ? join(homeDirectory, host.defaultRoot) : undefined);
		const usable = raw !== undefined && isAbsolute(raw) && !raw.includes(":");
		resolved.set(host.agent, {
			registrationPath: usable ? join(raw, "skills", "ceal-guide") : undefined,
			rejectedOverride: raw !== undefined && !usable,
		});
	}
	if ([...resolved.values()].every((host) => !host.registrationPath)) return undefined;
	let guidePath: string;
	try {
		const releaseDirectory = dirname(realpathSync(executablePath));
		guidePath = resolve(releaseDirectory, "..", "..", "current", "guide");
		assertGuideAvailable(guidePath);
	} catch {
		return unavailableStore();
	}
	const act = (
		agent: CealAgentGuideHost | undefined,
		run: (agent: CealAgentGuideHost, registrationPath: string) => CealAgentGuideState,
	): CealAgentGuideState => {
		const target = isCealAgentGuideHost(agent) ? agent : DEFAULT_AGENT_GUIDE_HOST;
		const host = resolved.get(target)!;
		if (!host.registrationPath) return hostUnresolvedState(target, guidePath, host.rejectedOverride, resolved);
		return run(target, host.registrationPath);
	};
	return {
		inspect: (agent) => act(agent, (target, registrationPath) => inspectRegistration(guidePath, target, registrationPath, resolved)),
		register: (agent) => act(agent, (target, registrationPath) => registerGuide(guidePath, target, registrationPath, resolved)),
	};
}

function hostRow(agent: CealAgentGuideHost): { label: string; environmentVariable: string } {
	return CEAL_AGENT_GUIDE_HOSTS.find((host) => host.agent === agent)!;
}

// The missing guide asset is shared by every host, but the answer still names
// the host the operator asked about: an operator running `guide register claude`
// must not read `agent: codex` back from its own failure.
function unavailableStore(): CealAgentGuideStore {
	const state = (agent: CealAgentGuideHost | undefined): CealAgentGuideState =>
		unavailableState(isCealAgentGuideHost(agent) ? agent : DEFAULT_AGENT_GUIDE_HOST);
	return { inspect: (agent) => state(agent), register: (agent) => state(agent) };
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
function hostUnresolvedState(
	agent: CealAgentGuideHost,
	guidePath: string,
	rejectedOverride: boolean,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): CealAgentGuideState {
	const { label, environmentVariable } = hostRow(agent);
	return {
		status: "unavailable",
		agent,
		guide_id: "ceal-guide",
		guide_path: guidePath,
		update_safe: false,
		registered: false,
		hosts: hostStates(guidePath, resolved),
		error: {
			kind: "registration_failed",
			message: rejectedOverride
				? `The configured ${label} directory is not one absolute path.`
				: `The ${label} configuration directory could not be resolved for this command runtime.`,
			next_action: rejectedOverride
				? `Set ${environmentVariable} to one absolute directory path, then run 'ceal guide status'.`
				: `Set HOME or ${environmentVariable}, then run 'ceal guide status'.`,
		},
	};
}

function assertGuideAvailable(guidePath: string): void {
	const skillPath = join(guidePath, "SKILL.md");
	if (!existsSync(skillPath) || !lstatSync(skillPath).isFile()) throw new Error("guide_unavailable");
}

function hostStates(
	guidePath: string,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): readonly CealAgentGuideHostState[] {
	return CEAL_AGENT_GUIDE_HOSTS.map((host) => {
		const registrationPath = resolved.get(host.agent)?.registrationPath;
		if (!registrationPath) return { agent: host.agent, status: "unresolved", registered: false } satisfies CealAgentGuideHostState;
		const registered = registrationMatches(guidePath, registrationPath);
		return {
			agent: host.agent,
			status: registered ? "registered" : "staged",
			registration_path: registrationPath,
			registered,
		} satisfies CealAgentGuideHostState;
	});
}

function inspectRegistration(
	guidePath: string,
	agent: CealAgentGuideHost,
	registrationPath: string,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
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
		hosts: hostStates(guidePath, resolved),
	};
}

// A failed or refused registration must not leave the acting host reading
// `staged` in `hosts`: a reader that treats `hosts` as the per-host source of
// truth would otherwise see "ready to link" for the exact path that just
// refused to link.
function withActingHostUnavailable(state: CealAgentGuideState, agent: CealAgentGuideHost): readonly CealAgentGuideHostState[] | undefined {
	return state.hosts?.map((host) => (host.agent === agent ? { ...host, status: "unavailable", registered: false } : host));
}

function registerGuide(
	guidePath: string,
	agent: CealAgentGuideHost,
	registrationPath: string,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): CealAgentGuideState {
	try {
		if (existsSync(registrationPath) || isDanglingSymlink(registrationPath)) {
			if (registrationMatches(guidePath, registrationPath)) return inspectRegistration(guidePath, agent, registrationPath, resolved);
			return conflictState(guidePath, agent, registrationPath, resolved);
		}
		mkdirSync(dirname(registrationPath), { recursive: true, mode: 0o700 });
		symlinkSync(guidePath, registrationPath, "dir");
		return inspectRegistration(guidePath, agent, registrationPath, resolved);
	} catch {
		const inspected = inspectRegistration(guidePath, agent, registrationPath, resolved);
		// Distinguish "the skills directory itself is unusable" from "something
		// occupies the registration path". Found on a real host whose
		// `~/.claude/skills` is a link to a directory that does not exist: the
		// generic advice to retry "without replacing an existing skill directory"
		// sent the operator looking for a file that was never there.
		const danglingParent = danglingParentTarget(registrationPath);
		return {
			...inspected,
			status: "unavailable",
			registered: false,
			hosts: withActingHostUnavailable(inspected, agent),
			error: {
				kind: "registration_failed",
				message: danglingParent === undefined
					? `The Ceal guide could not be registered with ${hostRow(agent).label}.`
					: `The ${hostRow(agent).label} skills directory is a link to '${danglingParent}', which does not exist.`,
				next_action: danglingParent === undefined
					? "Inspect the reported registration path and retry without replacing an existing skill directory."
					: `Create that directory, or set ${hostRow(agent).environmentVariable} to a usable configuration directory, then retry.`,
			},
		};
	}
}

function conflictState(
	guidePath: string,
	agent: CealAgentGuideHost,
	registrationPath: string,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): CealAgentGuideState {
	const inspected = inspectRegistration(guidePath, agent, registrationPath, resolved);
	return {
		...inspected,
		status: "unavailable",
		registered: false,
		hosts: withActingHostUnavailable(inspected, agent),
		error: {
			kind: "registration_conflict",
			message: `The ${hostRow(agent).label} ceal-guide path already contains an unmanaged file, directory, or link.`,
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

// The target a registration path's own parent link points at, when that parent is
// a link to nothing. `mkdir -p` cannot create through such a parent, so the
// failure is about the skills directory, not about the guide or the leaf path.
function danglingParentTarget(registrationPath: string): string | undefined {
	const parent = dirname(registrationPath);
	if (!isDanglingSymlink(parent) || existsSync(parent)) return undefined;
	try { return readlinkSync(parent); } catch { return undefined; }
}

function isDanglingSymlink(path: string): boolean {
	try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}
