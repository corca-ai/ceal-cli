type ScriptFailureIo = Pick<Console, "log" | "error">;
type ScriptFailureError = Readonly<{ code: string; message: string }>;
type ScriptFailureRenderInput = Readonly<{
	fallbackCode: string;
	fallbackMessage: string;
	json: boolean;
	knownError?: ScriptFailureError;
	schemaVersion: string;
}>;

/** Render a completed CLI failure without owning the caller's error contract. */
export function renderScriptFailure(
	io: ScriptFailureIo,
	{ fallbackCode, fallbackMessage, json, knownError, schemaVersion }: ScriptFailureRenderInput,
): void {
	const payload = {
		schema_version: schemaVersion,
		ok: false,
		error_code: knownError?.code ?? fallbackCode,
		message: knownError?.message ?? fallbackMessage,
	};
	if (json) io.log(JSON.stringify(payload));
	else io.error(payload.message);
}
