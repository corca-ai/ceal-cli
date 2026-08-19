import { permissionMode } from "./filesystem-mode.js";
import { type CealGuideBundle, decodeCealGuideBundle } from "./guide-bundle.js";
import { resolveInstalledWorkerRelease } from "./managed-worker-install.js";
import { isSha256Digest, sha256 } from "./sha256.js";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
	return present.length === 1 ? present[0]?.agent : undefined;
}

const defaultAgentGuideHost = CEAL_AGENT_GUIDE_HOSTS.at(0);
if (defaultAgentGuideHost === undefined) throw new Error("agent_guide_hosts_empty");
const DEFAULT_AGENT_GUIDE_HOST = defaultAgentGuideHost.agent;

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

interface CealAgentGuideHostState {
	agent: CealAgentGuideHost;
	// `unresolved` is a configuration answer, not a registration answer: the host
	// is supported and its route is advertised, but no directory was located, so
	// this entry deliberately carries no registration_path.
	status: "registered" | "staged" | "unavailable" | "unresolved";
	registration_path?: string;
	registered: boolean;
}

/**
 * How many hosts this guide is actually registered with.
 *
 * It lives here, beside `hostStates`, because two emitters each derived it and
 * both derived it wrong: they counted `registration_path`, which a merely
 * `staged` host carries too, so an operator who had never run `guide register`
 * reported registrations nobody made. `registered` is the state that says a
 * registration happened, and this is the one place that reads it for a count.
 */
export function countRegisteredGuideHosts(state: CealAgentGuideState | undefined): number {
	return state?.hosts?.filter((host) => host.registered).length ?? 0;
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
	carrier?: "generation" | "embedded";
	materialized?: boolean;
	next_action?: string;
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
	registrationPath: string | undefined;
	rejectedOverride: boolean;
}

export function createCealAgentGuideStore(
	executablePath: string,
	homeDirectory: string | undefined,
	codexHomeDirectory: string | undefined,
	claudeConfigDirectory?: string | undefined,
	detectedHost?: CealAgentGuideHost | undefined,
	embeddedGuideBundle?: Uint8Array | null | undefined,
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
	let guidePath: string;
	let legacyGuidePath: string | undefined;
	let embedded: { bundle: CealGuideBundle; stateRoot: string } | undefined;
	try {
		const releaseDirectory = dirname(realpathSync(executablePath));
		legacyGuidePath = resolve(releaseDirectory, "..", "..", "current", "guide");
		if (embeddedGuideBundle !== undefined) {
			if (embeddedGuideBundle === null) throw new Error("embedded_guide_missing");
			const installed = resolveInstalledWorkerRelease(executablePath);
			const workerState = dirname(dirname(installed.generationDirectory));
			embedded = { bundle: decodeCealGuideBundle(embeddedGuideBundle), stateRoot: join(workerState, "guides") };
			guidePath = join(embedded.stateRoot, "versions", embedded.bundle.sha256);
		} else {
			guidePath = legacyGuidePath;
			assertGuideAvailable(guidePath);
		}
	} catch {
		return unavailableStore(defaultAgent, detectedHost);
	}
	const act = (
		agent: CealAgentGuideHost | undefined,
		run: (agent: CealAgentGuideHost, registrationPath: string) => CealAgentGuideState,
	): CealAgentGuideState => {
		const target = isCealAgentGuideHost(agent) ? agent : defaultAgent;
		const host = resolved.get(target);
		if (host === undefined) throw new Error("agent_guide_host_unresolved");
		if (!host.registrationPath) return hostUnresolvedState(target, guidePath, host.rejectedOverride, resolved);
		return run(target, host.registrationPath);
	};
	const sourced = (state: CealAgentGuideState): CealAgentGuideState => ({
		...state,
		agent_source: state.agent === detectedHost ? "detected" : "default",
	});
	return {
		inspect: (agent) => sourced(act(agent, (target) => inspectRegistration(guidePath, target, resolved, embedded?.bundle))),
		register: (agent) =>
			act(agent, (target, registrationPath) => {
				if (embedded) {
					const disposition = registrationDisposition(registrationPath, guidePath, legacyGuidePath, embedded.stateRoot);
					if (disposition === "managed_previous") return conflictState(guidePath, target, resolved, embedded.bundle, registrationPath);
					if (disposition === "foreign") return conflictState(guidePath, target, resolved, embedded.bundle);
					try {
						materializeEmbeddedGuide(embedded.stateRoot, embedded.bundle);
					} catch {
						return guideMaterializationFailure(guidePath, target, resolved, embedded.bundle);
					}
				}
				return registerGuide(guidePath, target, registrationPath, resolved, legacyGuidePath, embedded?.stateRoot, embedded?.bundle);
			}),
	};
}

function hostRow(agent: CealAgentGuideHost): (typeof CEAL_AGENT_GUIDE_HOSTS)[number] {
	const row = CEAL_AGENT_GUIDE_HOSTS.find((host) => host.agent === agent);
	if (row === undefined) throw new Error("agent_guide_host_unknown");
	return row;
}

// The missing guide asset is shared by every host, but the answer still names
// the host the operator asked about: an operator running `guide register claude`
// must not read `agent: codex` back from its own failure.
function unavailableStore(defaultAgent: CealAgentGuideHost, detectedHost: CealAgentGuideHost | undefined): CealAgentGuideStore {
	const state = (agent: CealAgentGuideHost | undefined): CealAgentGuideState => {
		const target = isCealAgentGuideHost(agent) ? agent : defaultAgent;
		return { ...unavailableState(target), agent_source: target === detectedHost ? "detected" : "default" };
	};
	return {
		inspect: (agent) => state(agent),
		register: (agent) => unavailableState(isCealAgentGuideHost(agent) ? agent : defaultAgent),
	};
}

function unavailableState(agent: CealAgentGuideHost): CealAgentGuideState {
	return {
		status: "unavailable",
		agent,
		guide_id: "ceal-guide",
		update_safe: false,
		error: {
			kind: "guide_unavailable",
			message: "The signed Ceal guide is not carried by this installed binary.",
			next_action:
				"The installed binary remains usable. Run 'ceal update' when a newer signed release is available, then retry 'ceal guide status'; report the release if the guide is still unavailable.",
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

function hostStates(
	guidePath: string,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
	guideUsable = true,
): readonly CealAgentGuideHostState[] {
	return CEAL_AGENT_GUIDE_HOSTS.map((host) => {
		const registrationPath = resolved.get(host.agent)?.registrationPath;
		if (!registrationPath) return { agent: host.agent, status: "unresolved", registered: false } satisfies CealAgentGuideHostState;
		const registered = guideUsable && registrationMatches(guidePath, registrationPath);
		return {
			agent: host.agent,
			status: registered ? "registered" : guideUsable ? "staged" : "unavailable",
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
	embeddedBundle?: CealGuideBundle,
): CealAgentGuideState {
	const embedded = embeddedBundle !== undefined;
	const materialized = pathEntryExists(guidePath);
	if (embeddedBundle && materialized) {
		try {
			verifyMaterializedGuide(guidePath, embeddedBundle);
		} catch {
			return guideIntegrityFailure(guidePath, agent, resolved);
		}
	}
	const registrationPath = resolved.get(agent)?.registrationPath;
	const registered = registrationPath === undefined ? false : registrationMatches(guidePath, registrationPath);
	return {
		status: "available",
		agent,
		guide_id: "ceal-guide",
		...(!embedded || materialized ? { guide_path: guidePath } : {}),
		update_safe: !embedded,
		...(embedded
			? {
					carrier: "embedded" as const,
					materialized,
					...(registered
						? {}
						: {
								next_action: `Run 'ceal guide register ${agent}' to stage and register this signed guide directory for ${hostRow(agent).label}.`,
							}),
				}
			: {}),
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
	legacyGuidePath?: string,
	embeddedStateRoot?: string,
	embeddedBundle?: CealGuideBundle,
): CealAgentGuideState {
	try {
		if (existsSync(registrationPath) || isDanglingSymlink(registrationPath)) {
			if (registrationMatches(guidePath, registrationPath)) return inspectRegistration(guidePath, agent, resolved, embeddedBundle);
			// The signed 0.76.1 runtime registered the generation-local `current/guide`
			// path. Preserve that link, like every other occupant: portable filesystems
			// cannot replace it conditionally without deleting a concurrent foreign entry.
			const managedPrevious =
				(legacyGuidePath && registrationPointsTo(registrationPath, legacyGuidePath)) ||
				(embeddedStateRoot && registrationPointsIntoEmbeddedState(registrationPath, embeddedStateRoot));
			if (managedPrevious) return conflictState(guidePath, agent, resolved, embeddedBundle, registrationPath);
			return conflictState(guidePath, agent, resolved, embeddedBundle);
		}
		mkdirSync(dirname(registrationPath), { recursive: true, mode: 0o700 });
		symlinkSync(guidePath, registrationPath, "dir");
		return inspectRegistration(guidePath, agent, resolved, embeddedBundle);
	} catch {
		// Another process can publish the same registration after the existence
		// check and before symlinkSync. The requested final state is success even
		// when this process lost that race; a different occupant is still the same
		// deliberate conflict the pre-check reports.
		if (registrationMatches(guidePath, registrationPath)) return inspectRegistration(guidePath, agent, resolved, embeddedBundle);
		if (existsSync(registrationPath) || isDanglingSymlink(registrationPath)) return conflictState(guidePath, agent, resolved, embeddedBundle);
		const inspected = inspectRegistration(guidePath, agent, resolved, embeddedBundle);
		// Distinguish "the skills directory itself is unusable" from "something
		// occupies the registration path". Found on a real host whose
		// `~/.claude/skills` is a link to a directory that does not exist: the
		// generic advice to retry "without replacing an existing skill directory"
		// sent the operator looking for a file that was never there.
		const danglingParent = danglingParentTarget(registrationPath);
		return unavailableFromInspection(inspected, agent, {
			kind: "registration_failed",
			message:
				danglingParent === undefined
					? `The Ceal guide could not be registered with ${hostRow(agent).label}.`
					: `The ${hostRow(agent).label} skills directory is a link to '${danglingParent}', which does not exist.`,
			next_action:
				danglingParent === undefined
					? "Inspect the reported registration path and retry without replacing an existing skill directory."
					: `Create that directory, or set ${hostRow(agent).environmentVariable} to a usable configuration directory, then retry.`,
		});
	}
}

function guideMaterializationFailure(
	guidePath: string,
	agent: CealAgentGuideHost,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
	embeddedBundle: CealGuideBundle,
): CealAgentGuideState {
	const inspected = inspectRegistration(guidePath, agent, resolved, embeddedBundle);
	return unavailableFromInspection(inspected, agent, {
		kind: "registration_failed",
		message: "The signed Ceal guide could not be staged in local guide state.",
		next_action: `Inspect '${dirname(guidePath)}' and retry 'ceal guide register ${agent}'. The installed Ceal binary is unaffected.`,
	});
}

function guideIntegrityFailure(
	guidePath: string,
	agent: CealAgentGuideHost,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
): CealAgentGuideState {
	return {
		status: "unavailable",
		agent,
		guide_id: "ceal-guide",
		update_safe: false,
		carrier: "embedded",
		materialized: false,
		hosts: hostStates(guidePath, resolved, false),
		error: {
			kind: "registration_failed",
			message: "The materialized Ceal guide does not match the signed guide carried by this binary.",
			next_action: `Inspect '${guidePath}' and report the integrity failure. The installed Ceal binary is unaffected.`,
		},
	};
}

function materializeEmbeddedGuide(stateRoot: string, bundle: CealGuideBundle): void {
	const versions = join(stateRoot, "versions");
	const ownership = join(stateRoot, "ownership");
	ensureRegularDirectory(stateRoot);
	ensureRegularDirectory(versions);
	ensureRegularDirectory(ownership);
	const target = join(versions, bundle.sha256);
	if (pathEntryExists(target)) verifyMaterializedGuide(target, bundle);
	else {
		const staging = mkdtempSync(join(versions, `.next-${bundle.sha256}-`));
		try {
			for (const file of bundle.files) {
				const destination = join(staging, ...file.path.split("/"));
				ensureRegularDirectory(dirname(destination));
				writeFileSync(destination, file.bytes, { flag: "wx", mode: file.mode });
				chmodSync(destination, file.mode);
			}
			try {
				renameSync(staging, target);
			} catch {
				if (!pathEntryExists(target)) throw new Error("guide_publish_failed");
			}
		} finally {
			rmSync(staging, { recursive: true, force: true });
		}
		verifyMaterializedGuide(target, bundle);
	}
	ensureGuideOwnershipMarker(ownership, bundle.sha256);
}

function ensureGuideOwnershipMarker(ownership: string, digest: string): void {
	const marker = join(ownership, digest);
	const expected = `ceal.worker_guide_materialization.v1 ${digest}\n`;
	try {
		writeFileSync(marker, expected, { flag: "wx", mode: 0o600 });
	} catch {
		// A concurrent registration can publish the same immutable version. Its
		// marker is acceptable only when it is the exact Ceal-owned statement.
	}
	const stat = lstatSync(marker);
	if (stat.isSymbolicLink() || !stat.isFile() || permissionMode(stat) !== 0o600 || readFileSync(marker, "utf8") !== expected)
		throw new Error("unsafe_guide_state");
}

function pathEntryExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

function ensureRegularDirectory(path: string): void {
	if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
	const stat = lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7022) !== 0) throw new Error("unsafe_guide_state");
}

function verifyMaterializedGuide(root: string, bundle: CealGuideBundle): void {
	const rootStat = lstatSync(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || permissionMode(rootStat) !== 0o700) throw new Error("unsafe_guide_state");
	const expected = new Map(bundle.files.map((file) => [file.path, file]));
	const observed: string[] = [];
	const visit = (directory: string, prefix: string): void => {
		for (const entry of readdirSync(directory).sort()) {
			const relative = prefix ? `${prefix}/${entry}` : entry;
			const absolute = join(directory, entry);
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) throw new Error("unsafe_guide_state");
			if (stat.isDirectory()) {
				if (permissionMode(stat) !== 0o700) throw new Error("unsafe_guide_state");
				visit(absolute, relative);
			} else if (stat.isFile()) observed.push(relative);
			else throw new Error("unsafe_guide_state");
		}
	};
	visit(root, "");
	if (observed.length !== expected.size || observed.some((path) => !expected.has(path))) throw new Error("guide_state_drift");
	for (const [path, file] of expected) {
		const absolute = join(root, ...path.split("/"));
		const stat = lstatSync(absolute);
		if (sha256(readFileSync(absolute)) !== sha256(Buffer.from(file.bytes)) || permissionMode(stat) !== file.mode)
			throw new Error("guide_state_drift");
	}
}

function registrationPointsIntoEmbeddedState(registrationPath: string, stateRoot: string): boolean {
	try {
		const target = registrationTarget(registrationPath);
		if (!target) return false;
		const versions = join(stateRoot, "versions");
		const digest = target.slice(target.lastIndexOf("/") + 1);
		if (dirname(target) !== versions || !isSha256Digest(digest)) return false;
		const targetStat = lstatSync(target);
		const marker = join(stateRoot, "ownership", digest);
		const markerStat = lstatSync(marker);
		return (
			targetStat.isDirectory() &&
			!targetStat.isSymbolicLink() &&
			markerStat.isFile() &&
			!markerStat.isSymbolicLink() &&
			permissionMode(markerStat) === 0o600 &&
			readFileSync(marker, "utf8") === `ceal.worker_guide_materialization.v1 ${digest}\n`
		);
	} catch {
		return false;
	}
}

function conflictState(
	guidePath: string,
	agent: CealAgentGuideHost,
	resolved: ReadonlyMap<CealAgentGuideHost, ResolvedGuideHost>,
	embeddedBundle?: CealGuideBundle,
	managedPreviousPath?: string,
): CealAgentGuideState {
	const inspected = inspectRegistration(guidePath, agent, resolved, embeddedBundle);
	return unavailableFromInspection(inspected, agent, {
		kind: "registration_conflict",
		message:
			managedPreviousPath === undefined
				? `The ${hostRow(agent).label} ceal-guide path already contains an unmanaged file, directory, or link.`
				: `The ${hostRow(agent).label} ceal-guide path still points at an earlier Ceal-managed guide.`,
		next_action:
			managedPreviousPath === undefined
				? "Inspect the existing registration path and replace it deliberately before retrying."
				: `Remove the existing link at '${managedPreviousPath}', then retry 'ceal guide register ${agent}'. It is preserved because portable filesystems provide no conditional atomic link replacement.`,
	});
}

function unavailableFromInspection(
	inspected: CealAgentGuideState,
	agent: CealAgentGuideHost,
	error: NonNullable<CealAgentGuideState["error"]>,
): CealAgentGuideState {
	const hosts = withActingHostUnavailable(inspected, agent);
	return {
		...inspected,
		status: "unavailable",
		...(hosts === undefined ? {} : { hosts }),
		error,
	};
}

function registrationDisposition(
	registrationPath: string,
	guidePath: string,
	legacyGuidePath: string | undefined,
	embeddedStateRoot: string,
): "empty" | "current" | "managed_previous" | "foreign" {
	if (!existsSync(registrationPath) && !isDanglingSymlink(registrationPath)) return "empty";
	if (registrationPointsTo(registrationPath, guidePath)) return "current";
	if (
		(legacyGuidePath && registrationPointsTo(registrationPath, legacyGuidePath)) ||
		registrationPointsIntoEmbeddedState(registrationPath, embeddedStateRoot)
	)
		return "managed_previous";
	return "foreign";
}

function registrationPointsTo(registrationPath: string, targetPath: string): boolean {
	return registrationTarget(registrationPath) === targetPath;
}

function registrationMatches(guidePath: string, registrationPath: string): boolean {
	try {
		const resolvedLink = registrationTarget(registrationPath);
		if (!resolvedLink) return false;
		return realpathSync(resolvedLink) === realpathSync(guidePath);
	} catch {
		return false;
	}
}

function registrationTarget(registrationPath: string): string | undefined {
	try {
		if (!lstatSync(registrationPath).isSymbolicLink()) return undefined;
		const link = readlinkSync(registrationPath);
		return isAbsolute(link) ? link : resolve(dirname(registrationPath), link);
	} catch {
		return undefined;
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
