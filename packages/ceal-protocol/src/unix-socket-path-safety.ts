// macOS reserves 104 bytes for sockaddr_un.sun_path (including the NUL byte).
// Keep filesystem socket paths portable instead of relying on Linux's longer
// limit or allowing Node to create an unaddressable truncated path.
export const PORTABLE_UNIX_SOCKET_PATH_MAX_BYTES = 103;

export function isSafeUnixSocketPath(value: unknown): value is string {
	return typeof value === "string"
		&& value.startsWith("/")
		&& Buffer.byteLength(value, "utf8") <= PORTABLE_UNIX_SOCKET_PATH_MAX_BYTES
		&& !/[\r\n\0]/u.test(value);
}
