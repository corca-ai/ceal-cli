import { LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV } from "./generated/leased-consumer-attachment-stream-contract.js";
import { runLeasedConsumerAttachmentStreamEntrypoint } from "./leased-consumer-attachment-stream-entrypoint.js";
import { LEASED_CONSUMER_CARRIER_ARGV, readLeasedConsumerRequest, runLeasedConsumerCarrier } from "./leased-consumer-carrier.js";
import {
	LEASED_CONSUMER_CONTROL_SESSION_ARGV,
	openLeasedConsumerControlSession,
	openLeasedConsumerNotificationChannel,
	runLeasedConsumerControlTransport,
	writeLeasedConsumerAgentFrame,
} from "./leased-consumer-control-session.js";

export async function runPrivateCli(arg: string): Promise<number | undefined> {
	if (arg === LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV) return await runLeasedConsumerAttachmentStreamEntrypoint();
	if (arg === LEASED_CONSUMER_CARRIER_ARGV) return await runCarrier();
	if (arg === LEASED_CONSUMER_CONTROL_SESSION_ARGV) return await runControlSession();
	return undefined;
}

async function runCarrier(): Promise<number> {
	let request: Awaited<ReturnType<typeof readLeasedConsumerRequest>>;
	try {
		request = await readLeasedConsumerRequest(process.stdin);
	} catch {
		process.stdout.write(
			'{"schema_version":"ceal.leased_consumer_call_result.v1","ok":false,"status":"error","error_code":"invalid_request"}\n',
		);
		return 2;
	}
	let result: Awaited<ReturnType<typeof runLeasedConsumerCarrier>>;
	try {
		result = await runLeasedConsumerCarrier(request);
	} catch {
		process.stdout.write(
			'{"schema_version":"ceal.leased_consumer_call_result.v1","ok":false,"status":"error","error_code":"service_call_failed"}\n',
		);
		return 3;
	}
	process.stdout.write(`${JSON.stringify(result)}\n`);
	return result.error_code === "leased_consumer_call_unavailable" || result.error_code === "service_channel_unavailable" ? 3 : 2;
}

async function runControlSession(): Promise<number> {
	try {
		const session = await openLeasedConsumerControlSession();
		const notificationChannel = openLeasedConsumerNotificationChannel();
		const cleanClose = await runLeasedConsumerControlTransport(
			process.stdin,
			session,
			(frame, signal) => writeLeasedConsumerAgentFrame(process.stdout, frame, signal),
			notificationChannel,
			() => closeProcessStdin(),
		);
		return cleanClose ? 0 : 3;
	} catch {
		return 3;
	}
}

function closeProcessStdin(): Promise<void> {
	if (process.stdin.destroyed) return Promise.resolve();
	return new Promise<void>((resolve) => {
		process.stdin.once("close", resolve);
		process.stdin.destroy();
	});
}
