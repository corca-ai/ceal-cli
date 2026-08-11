import { CEAL_COMMAND_CONTEXT_KEYS, type CealCommandContext, type CealCommandRuntime } from "./cli-runtime.js";
import { ensureCurrentSessionWithRuntime, runSessionLogoutWithRuntime } from "./client-session.js";
import { commitEnrolledSession } from "./session-replacement.js";

/**
 * Project embedding input into the capabilities command code may name.
 *
 * Safe properties are declared once in `cli-runtime.ts`, then forwarded through
 * accessors so prototype and non-enumerable members from class embeddings keep
 * working. The null-prototype, non-extensible result has no path back to raw
 * session mutation or to the embedding's prototype.
 */
export function createCealCommandContext(runtime: CealCommandRuntime): CealCommandContext {
	const commitEnrolled: NonNullable<CealCommandContext["session"]["commitEnrolled"]> = (incoming, force) =>
		commitEnrolledSession(incoming, runtime, force);
	const ensureCurrent: NonNullable<CealCommandContext["session"]["ensureCurrent"]> = (stored, force) =>
		ensureCurrentSessionWithRuntime(stored, runtime, force);
	const logout: NonNullable<CealCommandContext["session"]["logout"]> = (sessionIo) => runSessionLogoutWithRuntime(sessionIo, runtime);
	const session = {} as CealCommandContext["session"];
	Object.defineProperties(session, {
		// Capability discovery is lazy: an unrelated command must not execute an
		// embedding's session getters merely because the context was composed.
		commitEnrolled: {
			get: () => (runtime.loadSession && runtime.saveSession ? commitEnrolled : undefined),
			enumerable: true,
		},
		// A current session is read-only and needs no writer. The bound owner
		// decides whether a stale one has enough persistence to rotate safely.
		ensureCurrent: { value: ensureCurrent, enumerable: true },
		logout: {
			get: () => (runtime.loadSession && runtime.removeSession ? logout : undefined),
			enumerable: true,
		},
	});
	Object.freeze(session);
	const context = Object.create(null) as CealCommandContext;
	const boundMethods = new Map<PropertyKey, { source: (...args: never[]) => unknown; bound: (...args: never[]) => unknown }>();
	const read = (property: (typeof CEAL_COMMAND_CONTEXT_KEYS)[number]): unknown => {
		const value = Reflect.get(runtime, property, runtime);
		if (typeof value !== "function") return value;
		const existing = boundMethods.get(property);
		if (existing?.source === value) return existing.bound;
		const source = value as (...args: never[]) => unknown;
		const bound = source.bind(runtime);
		boundMethods.set(property, { source, bound });
		return bound;
	};
	for (const property of CEAL_COMMAND_CONTEXT_KEYS) {
		Object.defineProperty(context, property, { get: () => read(property), enumerable: true });
	}
	Object.defineProperty(context, "session", { value: session, enumerable: true });
	return Object.preventExtensions(context);
}
