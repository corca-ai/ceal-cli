export interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	let rejectPromise: ((reason?: unknown) => void) | undefined;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: (value) => {
			if (!resolvePromise) throw new Error("deferred resolver used before initialization");
			resolvePromise(value);
		},
		reject: (reason) => {
			if (!rejectPromise) throw new Error("deferred rejecter used before initialization");
			rejectPromise(reason);
		},
	};
}

export function deferredVoid(): Omit<Deferred<void>, "resolve"> & { resolve: () => void } {
	const deferredValue = deferred<void>();
	return {
		promise: deferredValue.promise,
		resolve: () => deferredValue.resolve(undefined),
		reject: deferredValue.reject,
	};
}
