import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface CealAgentGuideState {
	status: "registered" | "staged" | "unavailable";
	agent: "codex";
	guide_id: "ceal-guide";
	guide_path?: string;
	registration_path?: string;
	update_safe: boolean;
	registered: boolean;
	error?: {
		kind: "guide_unavailable" | "registration_conflict" | "registration_failed";
		message: string;
		next_action: string;
	};
}

export interface CealAgentGuideStore {
	inspect(): CealAgentGuideState;
	register(): CealAgentGuideState;
}

export function createCealAgentGuideStore(
	executablePath: string,
	homeDirectory: string | undefined,
	codexHomeDirectory: string | undefined,
): CealAgentGuideStore | undefined {
	if (!homeDirectory && !codexHomeDirectory) return undefined;
	let guidePath: string;
	try {
		const releaseDirectory = dirname(realpathSync(executablePath));
		guidePath = resolve(releaseDirectory, "..", "..", "current", "guide");
		assertGuideAvailable(guidePath);
	} catch {
		return unavailableStore();
	}
	const codexRoot = codexHomeDirectory ?? join(homeDirectory!, ".codex");
	const registrationPath = join(codexRoot, "skills", "ceal-guide");
	return {
		inspect: () => inspectRegistration(guidePath, registrationPath),
		register: () => registerGuide(guidePath, registrationPath),
	};
}

function unavailableStore(): CealAgentGuideStore {
	const state = unavailableState();
	return { inspect: () => state, register: () => state };
}

function unavailableState(): CealAgentGuideState {
	return {
		status: "unavailable",
		agent: "codex",
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

function assertGuideAvailable(guidePath: string): void {
	const skillPath = join(guidePath, "SKILL.md");
	if (!existsSync(skillPath) || !lstatSync(skillPath).isFile()) throw new Error("guide_unavailable");
}

function inspectRegistration(guidePath: string, registrationPath: string): CealAgentGuideState {
	const registered = registrationMatches(guidePath, registrationPath);
	return {
		status: registered ? "registered" : "staged",
		agent: "codex",
		guide_id: "ceal-guide",
		guide_path: guidePath,
		registration_path: registrationPath,
		update_safe: true,
		registered,
	};
}

function registerGuide(guidePath: string, registrationPath: string): CealAgentGuideState {
	try {
		if (existsSync(registrationPath) || isDanglingSymlink(registrationPath)) {
			if (registrationMatches(guidePath, registrationPath)) return inspectRegistration(guidePath, registrationPath);
			return conflictState(guidePath, registrationPath);
		}
		mkdirSync(dirname(registrationPath), { recursive: true, mode: 0o700 });
		symlinkSync(guidePath, registrationPath, "dir");
		return inspectRegistration(guidePath, registrationPath);
	} catch {
		return {
			...inspectRegistration(guidePath, registrationPath),
			status: "unavailable",
			registered: false,
			error: {
				kind: "registration_failed",
				message: "The Ceal guide could not be registered with Codex.",
				next_action: "Inspect the reported registration path and retry without replacing an existing skill directory.",
			},
		};
	}
}

function conflictState(guidePath: string, registrationPath: string): CealAgentGuideState {
	return {
		...inspectRegistration(guidePath, registrationPath),
		status: "unavailable",
		registered: false,
		error: {
			kind: "registration_conflict",
			message: "The Codex ceal-guide path already contains an unmanaged file, directory, or link.",
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
