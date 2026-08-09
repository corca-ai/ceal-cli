export function nonCanonicalBase64urlAlias(value) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const index = alphabet.indexOf(value.at(-1));
	const unusedBits = (value.length * 6) % 8;
	if (index < 0 || unusedBits === 0) throw new TypeError("A padded base64url value is required");
	const aliasIndex = index + 1;
	if (aliasIndex >= alphabet.length || index >> unusedBits !== aliasIndex >> unusedBits) {
		throw new TypeError("The base64url value is not in canonical padded-bit form");
	}
	return `${value.slice(0, -1)}${alphabet[aliasIndex]}`;
}
