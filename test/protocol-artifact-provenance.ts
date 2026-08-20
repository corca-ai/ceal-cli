import type { ReleasePackageRecordInput } from "./release-package-record.ts";
import { writeFileSync } from "node:fs";
import path from "node:path";

export const PROTOCOL_HANDOFF_MARKER_NAME = ".ceal-protocol-handoff-owner";
export const PROTOCOL_HANDOFF_MARKER_CONTENTS = "ceal.gateway_protocol_handoff.v1\n";

export type ProtocolArtifactProducer = {
	readonly repository: string;
	readonly commit: string;
	readonly tree: string;
	readonly protocol_tree: string;
};

export type ScopedProtocolArtifactProducer = ProtocolArtifactProducer & { scoped_paths_clean: true };

export function createScopedProtocolArtifactProducer(producer: ProtocolArtifactProducer): ScopedProtocolArtifactProducer {
	return { ...producer, scoped_paths_clean: true };
}

export type ProtocolArtifactProvenance = {
	schema_version: "ceal.gateway_protocol_artifact.v1";
	proof_level: "local_state";
	writes_external: false;
	source: ProtocolArtifactProducer & { package_path: string };
	artifact: {
		package: string;
		version: string;
		filename: string;
		sha256: string;
		npm_integrity: string;
		exports: string[];
	};
};

export type ProtocolArtifactProvenanceFiles = {
	provenance: ProtocolArtifactProvenance;
	protocolProvenance: string;
};

export type ProtocolArtifactFixture<Protocol extends ReleasePackageRecordInput> = ProtocolArtifactProvenanceFiles & {
	producer: ScopedProtocolArtifactProducer;
	protocol: Protocol;
};

/** Build the shared Gateway Protocol artifact provenance shape for test fixtures. */
export function createProtocolArtifactProvenance(
	producer: ProtocolArtifactProducer,
	protocol: ReleasePackageRecordInput,
): ProtocolArtifactProvenance {
	return {
		schema_version: "ceal.gateway_protocol_artifact.v1",
		proof_level: "local_state",
		writes_external: false,
		source: {
			repository: producer.repository,
			commit: producer.commit,
			tree: producer.tree,
			protocol_tree: producer.protocol_tree,
			package_path: "packages/ceal-protocol",
		},
		artifact: {
			package: protocol.name,
			version: protocol.version,
			filename: protocol.filename,
			sha256: protocol.sha256,
			npm_integrity: protocol.integrity,
			exports: protocol.declared_exports,
		},
	};
}

export function writeProtocolArtifactProvenance(
	root: string,
	producer: ProtocolArtifactProducer,
	protocol: ReleasePackageRecordInput,
): ProtocolArtifactProvenanceFiles {
	const provenance = createProtocolArtifactProvenance(producer, protocol);
	writeFileSync(path.join(root, PROTOCOL_HANDOFF_MARKER_NAME), PROTOCOL_HANDOFF_MARKER_CONTENTS);
	const protocolProvenance = path.join(root, "gateway-protocol-provenance.json");
	writeFileSync(protocolProvenance, `${JSON.stringify(provenance)}\n`);
	return { provenance, protocolProvenance };
}

export function createProtocolArtifactFixture<Protocol extends ReleasePackageRecordInput>(
	root: string,
	producer: ProtocolArtifactProducer,
	pack: () => Protocol,
): ProtocolArtifactFixture<Protocol> {
	const protocol = pack();
	const scopedProducer = createScopedProtocolArtifactProducer(producer);
	const { provenance, protocolProvenance } = writeProtocolArtifactProvenance(root, scopedProducer, protocol);
	return { producer: scopedProducer, protocol, provenance, protocolProvenance };
}
