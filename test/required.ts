export function required<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`${label}_missing`);
	return value;
}

export function requiredCapture(match: RegExpExecArray, index: number, label: string): string {
	return required(match[index], label);
}
