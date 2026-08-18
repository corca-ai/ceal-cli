export type ReleasePackageRecordInput = {
	readonly name: string;
	readonly version: string;
	readonly filename: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly integrity: string;
	readonly declared_exports: string[];
};

export function releasePackageRecord(item: ReleasePackageRecordInput) {
	return {
		package: item.name,
		version: item.version,
		filename: item.filename,
		bytes: item.bytes,
		sha256: item.sha256,
		integrity: item.integrity,
		exports: item.declared_exports,
	};
}
