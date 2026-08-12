// Node's stat.mode contains both the file type and all Unix permission bits.
// Keep the special setuid/setgid/sticky bits when comparing a path against an
// exact mode: masking with 0o777 would silently turn 0o2700 into 0o700.
export function permissionMode(stat: { mode: number }): number {
	return stat.mode & 0o7777;
}
