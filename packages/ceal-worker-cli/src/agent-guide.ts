import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type CealAgentGuideHost = "codex" | "claude";

// One declaration per supported agent host: the environment override, the
// default root under HOME, and the human label its errors name. Adding a host
// means adding a row here plus its `guide register <host>` route — the state
// projection, conflict handling, and status readback derive from this table.
// The first row is the fallback projection for a host-less `guide status` when
// no host identifies itself; a detected running host wins over table order.
const CEAL_AGENT_GUIDE_HOSTS: readonly {
	agent: CealAgentGuideHost;
	label: string;
	defaultRoot: string;
	environmentVariable: string;
	/** Env markers the host process sets for itself; presence identifies it. */
	runningMarkers: readonly string[];
}[] = [
	{
		agent: "codex",
		label: "Codex",
		defaultRoot: ".codex",
		environmentVariable: "CODEX_HOME",
		runningMarkers: ["CODEX_SANDBOX", "CODEX_THREAD_ID"],
	},
	{
		agent: "claude",
		label: "Claude Code",
		defaultRoot: ".claude",
		environmentVariable: "CLAUDE_CONFIG_DIR",
		runningMarkers: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
	},
];

/**
 * Every environment variable that can redirect a host's state root.
 *
 * A caller that must neutralize those roots — the probe guard pinning them
 * inside a throwaway HOME — has to know the whole set, and a hand-kept copy of
 * it silently goes stale the moment a host row is added. Derive it here so the
 * table stays the one declaration.
 */
export const CEAL_AGENT_HOST_ENVIRONMENT_VARIABLES: readonly string[] = CEAL_AGENT_GUIDE_HOSTS.map((host) => host.environmentVariable);

/**
 * The agent host this process is running inside, when it says so.
 *
 * The projection used to default to the first declared host, so a Claude Code
 * session read `agent: codex` with `registered: false` while its own
 * registration was live, recorded that in a durable note, and only the
 * `non_claims` line contradicted it (corca-ai/ceal-cli#4). A reader should not
 * have to earn the right answer; when the running host is knowable, name it.
 */
export function detectCealAgentGuideHost(environment: Record<string, string | undefined>): CealAgentGuideHost | undefined {
	// A nested agent inherits the outer host's markers, so two hosts can look
	// present at once. Table order would then pick a host that is not the one
	// running and advise registering it — reinstating the reported bug one level
	// down. Ambiguity degrades to "undetected", which stays silent.
	const present = CEAL_AGENT_GUIDE_HOSTS.filter((host) => host.runningMarkers.some((marker) => environment[marker]));
	return present.length === 1 ? present[0]!.agent : undefined;
}

const DEFAULT_AGENT_GUIDE_HOST = CEAL_AGENT_GUIDE_HOSTS[0]!.agent;

/** Each host's state-root override, keyed the same way the table declares them. */
export type CealAgentHostOverrides = Partial<Record<CealAgentGuideHost, string | undefined>>;

export interface ResolvedCealAgentHostRoot {
	/** The host's state root, or undefined when nothing usable resolves one. */
	root: string | undefined;
	/** What to name the root in operator-facing output, override included. */
	displayRoot: string;
	rejectedOverride: boolean;
}

/**
 * Where a host actually keeps its state.
 *
 * Guide registration and the transcript audit both answer questions about the
 * same directory, so they must agree on where it is. They did not: the audit
 * hardcoded `~/.claude` and `~/.codex` and never read `CLAUDE_CONFIG_DIR` or
 * `CODEX_HOME`, so an operator who moved either root got a guide surface that
 * followed them and an audit that reported the untouched default as empty.
 */
export function resolveCealAgentHostRoot(
	agent: CealAgentGuideHost,
	homeDirectory: string | undefined,
	overrides: CealAgentHostOverrides,
): ResolvedCealAgentHostRoot {
	const row = hostRow(agent);
	const override = overrides[agent] || undefined;
	// An empty override is no override; a relative or list-shaped one is a
	// refusal, never a guess: `join`ing it would create a skill tree under the
	// current working directory, or under a literal `dir:`-named path, and then
	// report it as a real registration. Verified for the colon case: Claude Code
	// given `CLAUDE_CONFIG_DIR=a:b` finds neither directory's state.
	const raw = override ?? (homeDirectory ? join(homeDirectory, row.defaultRoot) : undefined);
	const usable = raw !== undefined && isAbsolute(raw) && !raw.includes(":");
	return {
		root: usable ? raw : undefined,
		displayRoot: override ?? `~/${row.defaultRoot}`,
		rejectedOverride: raw !== undefined && !usable,
	};
}

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
	// About this document, not about a host: did the command answer? Per-host
	// registration lives in `hosts` and nowhere else, so there is no summary to
	// mistake for the running host's state (corca-ai/ceal-cli#4).
	status: "available" | "unavailable";
	/** The host this document is about: the detected one, or the one a route named. */
	agent: CealAgentGuideHost;
	guide_id: "ceal-guide";
	guide_path?: string;
	update_safe: boolean;
	// Whether `agent` names the host this process is running inside, or a
	// fallback because no host identified itself. A reader that only reads the
	// top-level fields is right by default when this says `detected`.
	agent_source?: "detected" | "default";
	/** Every advertised host, including ones whose directory did not resolve. */
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
	detectedHost?: CealAgentGuideHost | undefined,
): CealAgentGuideStore | undefined {
	// The host this process runs inside answers "you" better than a table order.
	const defaultAgent = detectedHost ?? DEFAULT_AGENT_GUIDE_HOST;
	const overrides: Record<CealAgentGuideHost, string | undefined> = {
		codex: codexHomeDirectory,
		claude: claudeConfigDirectory,
	};
	const resolved = new Map<CealAgentGuideHost, ResolvedGuideHost>();
	for (const host of CEAL_AGENT_GUIDE_HOSTS) {
		const { root, rejectedOverride } = resolveCealAgentHostRoot(host.agent, homeDirectory, overrides);
		resolved.set(host.agent, {
			registrationPath: root ? join(root, "skills", "ceal-guide") : undefined,
			rejectedOverride,
		});
	}
	if ([...resolved.values()].every((host) => !host.registrationPath)) return undefined;
	let guidePath: string;
	try {
		const releaseDirectory = dirname(realpathSync(executablePath));
		guidePath = resolve(releaseDirectory, "..", "..", "current", "guide");
		assertGuideAvailable(guidePath);
	} catch {
		return unavailableStore(defaultAgent, detectedHost);
	}
	const act = (
		agent: CealAgentGuideHost | undefined,
		run: (agent: CealAgentGuideHost, registrationPath: string) => CealAgentGuideState,
	): CealAgentGuideState => {
		const target = isCealAgentGuideHost(agent) ? agent : defaultAgent;
		const host = resolved.get(target)!;
		if (!host.registrationPath) return hostUnresolvedState(target, guidePath, host.rejectedOverride, resolved);
		return run(target, host.registrationPath);
	};
	const sourced = (state: CealAgentGuideState): CealAgentGuideState => ({
		...state,
		agent_source: state.agent === detectedHost ? "detected" : "default",
	});
	return {
		inspect: (agent) => sourced(act(agent, (target) => inspectRegistration(guidePath, target, resolved))),
		register: (agent) => sourced(act(agent, (target, registrationPath) => registerGuide(guidePath, target, registrationPath, resolved))),
	};
}

function hostRow(agent: CealAgentGuideHost): (typeof CEAL_AGENT_GUIDE_HOSTS)[number] {
	return CEAL_AGENT_GUIDE_HOSTS.find((host) => host.agent === agent)!;
}

// The missing guide asset is shared by every host, but the answer still names
// the host the operator asked about: an operator running `guide register claude`
// must not read `agent: codex` back from its own failure.
function unavailableStore(defaultAgent: CealAgentGuideHost, detectedHost: CealAgentGuideHost | undefined): CealAgentGuideStore {
	const state = (agent: CealAgentGuideHost | undefined): CealAgentGuideState => {
		const target = isCealAgentGuideHost(agent) ? agent : defaultAgent;
		return { ...unavailableState(target), agent_source: target === detectedHost ? "detected" : "default" };
	};
	return { inspect: (agent) => state(agent), register: (agent) => state(agent) };
}

function unavailableState(agent: CealAgentGuideHost): CealAgentGuideState {
	return {
		status: "unavailable",
		agent,
		guide_id: "ceal-guide",
		update_safe: false,
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

function hostStates(guidePath: string, resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>): readonly CealAgentGuideHostState[] {
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

// The registration path is deliberately not a parameter: this function reports
// the whole resolved host set, so a single path could only mislead a reader into
// thinking the result were scoped to it.
function inspectRegistration(
	guidePath: string,
	agent: CealAgentGuideHost,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): CealAgentGuideState {
	return {
		status: "available",
		agent,
		guide_id: "ceal-guide",
		guide_path: guidePath,
		update_safe: true,
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
			if (registrationMatches(guidePath, registrationPath)) return inspectRegistration(guidePath, agent, resolved);
			return conflictState(guidePath, agent, resolved);
		}
		mkdirSync(dirname(registrationPath), { recursive: true, mode: 0o700 });
		symlinkSync(guidePath, registrationPath, "dir");
		return inspectRegistration(guidePath, agent, resolved);
	} catch {
		const inspected = inspectRegistration(guidePath, agent, resolved);
		// Distinguish "the skills directory itself is unusable" from "something
		// occupies the registration path". Found on a real host whose
		// `~/.claude/skills` is a link to a directory that does not exist: the
		// generic advice to retry "without replacing an existing skill directory"
		// sent the operator looking for a file that was never there.
		const danglingParent = danglingParentTarget(registrationPath);
		return {
			...inspected,
			status: "unavailable",
			hosts: withActingHostUnavailable(inspected, agent),
			error: {
				kind: "registration_failed",
				message:
					danglingParent === undefined
						? `The Ceal guide could not be registered with ${hostRow(agent).label}.`
						: `The ${hostRow(agent).label} skills directory is a link to '${danglingParent}', which does not exist.`,
				next_action:
					danglingParent === undefined
						? "Inspect the reported registration path and retry without replacing an existing skill directory."
						: `Create that directory, or set ${hostRow(agent).environmentVariable} to a usable configuration directory, then retry.`,
			},
		};
	}
}

function conflictState(
	guidePath: string,
	agent: CealAgentGuideHost,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): CealAgentGuideState {
	const inspected = inspectRegistration(guidePath, agent, resolved);
	return {
		...inspected,
		status: "unavailable",
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
	try {
		return readlinkSync(parent);
	} catch {
		return undefined;
	}
}

function isDanglingSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}
