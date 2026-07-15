export function validCallPrefix(options: readonly string[]): boolean {
	return options.length >= 3 && options.length <= 67 && options[1] === "--target";
}

export function validCapabilityId(value: string | undefined): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

export function validTargetRef(value: string | undefined): boolean {
	return typeof value === "string" && /^target:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value);
}
