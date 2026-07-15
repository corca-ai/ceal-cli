import type { CealLockedSessionStore, CealStoredSession } from "./profile-store.js";

export interface CealCliIo {
	stdout: { write(chunk: string): unknown };
	stderr: { write(chunk: string): unknown };
}

export interface CealCommandRuntime {
	readSecret?: () => Promise<string>;
	promptEnrollmentCode?: () => Promise<string>;
	isInteractiveTerminal?: () => boolean;
	isInputTerminal?: () => boolean;
	loadSession?: () => Promise<CealStoredSession | null>;
	saveSession?: (session: CealStoredSession) => Promise<void>;
	removeSession?: () => Promise<void>;
	withSessionStateLock?: <T>(action: (store: CealLockedSessionStore) => Promise<T>) => Promise<T>;
	nextRequestId?: () => string;
	now?: () => number;
}
