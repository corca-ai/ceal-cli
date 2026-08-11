import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeClientSessionStoreFixture(home, { gatewayEndpoint, label }) {
	const directory = path.join(home, ".ceal");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	writeFileSync(
		path.join(directory, "client-session.json"),
		`${JSON.stringify(
			{
				schema_version: "ceal.client_session_store.v1",
				gateway_endpoint: gatewayEndpoint,
				profile_ref: `profile:${label}`,
				membership_ref: `membership:${label}`,
				registration_ref: `registration:${label}`,
				client_ref: `client:${label}`,
				subject_ref: `subject:${label}`,
				instance_ref: `instance:${label}`,
				access_token: `ceal_personal_${"P".repeat(43)}`,
				expires_at: "2099-07-14T00:00:00.000Z",
				refresh_token: `ceal_refresh_${"R".repeat(43)}`,
				refresh_token_idle_expires_at: "2099-08-14T00:00:00.000Z",
				refresh_token_absolute_expires_at: "2099-10-14T00:00:00.000Z",
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
}
