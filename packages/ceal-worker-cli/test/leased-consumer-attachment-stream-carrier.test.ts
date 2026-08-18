import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, cpSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_JSON,
	LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_SHA256,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV,
	LEASED_CONSUMER_ATTACHMENT_STREAM_ROUTE_SHA256,
} from "../dist/generated/leased-consumer-attachment-stream-contract.js";
import type { LeasedConsumerAttachmentStreamCarrierRuntime } from "../dist/leased-consumer-attachment-stream-carrier.js";
import { consumeLeasedConsumerAttachmentStream } from "../dist/leased-consumer-attachment-stream-carrier.js";
import {
	runLeasedConsumerAttachmentStreamEntrypoint,
	serializeLeasedConsumerAttachmentStreamResult,
} from "../dist/leased-consumer-attachment-stream-entrypoint.js";
import { postUnixSocketStream, type UnixSocketErrorNames } from "../dist/private-worker-transport.js";
import { binding, chunked, completeManifest, document, image, streamBytes } from "./leased-consumer-attachment-stream-fixtures.ts";

const encoder = new TextEncoder();
const request = {
	schema_version: "ceal.leased_consumer_attachment_stream_request.v1",
	event_ref: binding.event_ref,
	lease_ref: binding.lease_ref,
	lease_fence: binding.lease_fence,
};

test("embedded candidate contract is refused when its digest is tampered", async (t) => {
	const dist = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
	const scratch = mkdtempSync(join(dist, "..", "ceal-attachment-contract-"));
	t.after(() => rmSync(scratch, { recursive: true, force: true }));
	const copyEntry = (name: string) => {
		const copy = join(scratch, name);
		cpSync(dist, copy, { recursive: true });
		return join(copy, "leased-consumer-attachment-stream-carrier.js");
	};
	const tamperedEntry = copyEntry("tampered");
	const intactEntry = copyEntry("intact");
	const embeddedPath = join(scratch, "tampered", "generated", "leased-consumer-attachment-stream-contract.js");
	const source = readFileSync(embeddedPath, "utf8");
	const tampered = source.replace(/CONTRACT_SHA256 = "[a-f0-9]{64}"/u, `CONTRACT_SHA256 = "${"0".repeat(64)}"`);
	assert.notEqual(tampered, source);
	writeFileSync(embeddedPath, tampered);
	await assert.rejects(import(tamperedEntry), /invalid_attachment_stream_contract/u);
	const intact = await import(intactEntry);
	assert.equal(typeof intact.consumeLeasedConsumerAttachmentStream, "function");
});

test("private candidate carrier derives its fixed route and produces the Agent handoff", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-attachment-carrier-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const socketPath = "/run/user/1001/ceal/gateway-candidate.sock";
	const calls: AttachmentStreamRequest[] = [];
	let sessionCloses = 0;
	let responseCloses = 0;
	let rootCalls = 0;
	const output = await consumeLeasedConsumerAttachmentStream(
		{
			request,
			expected_binding: binding,
			createHandoffRoot: () => {
				rootCalls += 1;
				return mkdtemp(join(root, "run-"));
			},
		},
		{
			env: {},
			readProtectedSession: async () => sessionBytes(socketPath),
			closeProtectedSession: async () => {
				sessionCloses += 1;
			},
			requestUnixSocketStream: async (input) => {
				calls.push(input);
				return {
					status: 200,
					contentType: "application/octet-stream",
					stream: chunked(
						streamBytes(completeManifest(), [
							[0, image],
							[1, document],
						]),
					),
					close: () => {
						responseCloses += 1;
					},
				};
			},
		},
	);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].socketPath, socketPath);
	assert.equal(calls[0].path, "/api/ceal/agent/v1/control/attachment-stream");
	assert.equal(calls[0].path.length > 0, true);
	assert.equal(calls[0].method, "POST");
	assert.equal(calls[0].credential, "private-service-credential");
	assert.equal(calls[0].body, JSON.stringify(request));
	assert.doesNotMatch(calls[0].body, /credential|socket|provider|path/u);
	assert.equal(calls[0].deadlineMs, 30_000);
	assert.ok(
		calls[0].maximumResponseBytes >=
			streamBytes(completeManifest(), [
				[0, image],
				[1, document],
			]).byteLength,
	);
	assert.equal(calls[0].errors.responseTooLarge, "attachment_stream_response_too_large");
	assert.equal(sessionCloses, 1);
	assert.equal(responseCloses, 1);
	assert.equal(rootCalls, 1);
	assert.equal(output.manifest.schema_version, "ceal.agent.attachment_materialization.v1");
	assert.deepEqual(
		output.manifest.attachments.map((entry) => [entry.slot, entry.status, "relative_path" in entry]),
		[
			[0, "materialized", true],
			[1, "materialized", true],
			[2, "unread", false],
		],
	);
	assert.deepEqual(await readFile(join(output.handoff_root, "attachments/0.bin")), image);
	assert.deepEqual(await readFile(join(output.handoff_root, "attachments/1.bin")), document);
	assert.deepEqual(JSON.parse(await readFile(output.manifest_path, "utf8")), output.manifest);
});

test("private attachment-stream entrypoint rejects path and credential fields before session or root authority", async () => {
	let protectedReads = 0;
	let rootCalls = 0;
	let stdout = "";
	const code = await runLeasedConsumerAttachmentStreamEntrypoint(
		chunked(
			encoder.encode(
				JSON.stringify({
					schema_version: "ceal.worker_private_leased_consumer_attachment_stream_request.v1",
					request,
					expected_binding: binding,
					handoff_root: "/tmp/caller-selected-root",
					credential: "caller-selected-credential",
				}),
			),
		),
		{
			write(chunk) {
				stdout += chunk;
				return true;
			},
		},
		{
			readProtectedSession: async () => {
				protectedReads += 1;
				return sessionBytes("/run/user/1001/ceal/gateway-candidate.sock");
			},
			createHandoffRoot: () => {
				rootCalls += 1;
				return "/tmp/caller-selected-root";
			},
		},
	);
	assert.equal(code, 2);
	assert.deepEqual(JSON.parse(stdout), {
		schema_version: "ceal.worker_private_leased_consumer_attachment_stream_result.v1",
		ok: false,
		status: "error",
		error_code: "invalid_request",
	});
	assert.equal(protectedReads, 0);
	assert.equal(rootCalls, 0);
});

test("private attachment-stream entrypoint rejects duplicate JSON keys and oversized input before session access", async () => {
	const inputs = [
		encoder.encode(
			'{"schema_version":"ceal.worker_private_leased_consumer_attachment_stream_request.v1","schema_version":"spoofed","request":{},"expected_binding":{}}',
		),
		new Uint8Array(32 * 1024 + 1),
	];
	for (const input of inputs) {
		let protectedReads = 0;
		let stdout = "";
		const code = await runLeasedConsumerAttachmentStreamEntrypoint(
			chunked(input),
			{
				write(chunk) {
					stdout += chunk;
					return true;
				},
			},
			{
				readProtectedSession: async () => {
					protectedReads += 1;
					return sessionBytes("/run/user/1001/ceal/gateway-candidate.sock");
				},
			},
		);
		assert.equal(code, 2);
		assert.equal(JSON.parse(stdout).error_code, "invalid_request");
		assert.equal(protectedReads, 0);
	}
});

test("private attachment-stream entrypoint returns only the verified Agent handoff envelope", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-attachment-entrypoint-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let stdout = "";
	const calls: AttachmentStreamRequest[] = [];
	const code = await runLeasedConsumerAttachmentStreamEntrypoint(
		chunked(
			encoder.encode(
				JSON.stringify({
					schema_version: "ceal.worker_private_leased_consumer_attachment_stream_request.v1",
					request,
					expected_binding: binding,
				}),
			),
		),
		{
			write(chunk) {
				stdout += chunk;
				return true;
			},
		},
		{
			env: {},
			readProtectedSession: async () => sessionBytes("/run/user/1001/ceal/gateway-candidate.sock"),
			closeProtectedSession: async () => {},
			createHandoffRoot: () => mkdtemp(join(root, "run-")),
			requestUnixSocketStream: async (input) => {
				calls.push(input);
				return {
					status: 200,
					contentType: "application/octet-stream",
					stream: chunked(
						streamBytes(completeManifest(), [
							[0, image],
							[1, document],
						]),
					),
					close: () => {},
				};
			},
		},
	);
	assert.equal(code, 0);
	const result = JSON.parse(stdout);
	assert.equal(result.schema_version, "ceal.worker_private_leased_consumer_attachment_stream_result.v1");
	assert.equal(result.ok, true);
	assert.equal(result.status, "handoff_ready");
	assert.equal(result.handoff.manifest.schema_version, "ceal.agent.attachment_materialization.v1");
	assert.ok(result.handoff.handoff_root.startsWith(root));
	assert.equal(calls.length, 1);
	assert.equal(calls[0].path, "/api/ceal/agent/v1/control/attachment-stream");
	assert.equal(calls[0].body, JSON.stringify(request));
	assert.doesNotMatch(stdout, /caller-selected|credential|provider/u);
});

test("private attachment-stream result serialization enforces its UTF-8 byte bound", () => {
	const oversized = serializeLeasedConsumerAttachmentStreamResult({
		schema_version: "ceal.worker_private_leased_consumer_attachment_stream_result.v1",
		ok: true,
		status: "handoff_ready",
		handoff: { handoff_root: "x".repeat(32 * 1024) },
	});
	assert.equal(oversized, null);

	const bounded = serializeLeasedConsumerAttachmentStreamResult({
		schema_version: "ceal.worker_private_leased_consumer_attachment_stream_result.v1",
		ok: false,
		status: "unavailable",
		error_code: "handoff_write_failed",
	});
	assert.ok(bounded);
	assert.ok(new TextEncoder().encode(bounded).byteLength <= 32 * 1024);
});

test("candidate carrier refuses request or protected-session drift before any network or handoff root", async () => {
	let protectedReads = 0;
	let networkCalls = 0;
	let rootCalls = 0;
	const runtime = {
		env: {},
		readProtectedSession: async () => {
			protectedReads += 1;
			return sessionBytes("/run/user/1001/ceal/gateway-candidate.sock");
		},
		closeProtectedSession: async () => {},
		requestUnixSocketStream: async () => {
			networkCalls += 1;
			throw new Error("must not reach transport");
		},
	};
	await assert.rejects(
		consumeLeasedConsumerAttachmentStream(
			{
				request: { ...request, lease_fence: 99 },
				expected_binding: binding,
				createHandoffRoot: () => {
					rootCalls += 1;
					return "/tmp/must-not-create";
				},
			},
			runtime,
		),
		(error) => hasErrorCode(error) && error.code === "request_binding_mismatch",
	);
	assert.equal(protectedReads, 0);
	assert.equal(networkCalls, 0);
	assert.equal(rootCalls, 0);

	await assert.rejects(
		consumeLeasedConsumerAttachmentStream(
			{
				request,
				expected_binding: binding,
				createHandoffRoot: () => {
					rootCalls += 1;
					return "/tmp/must-not-create";
				},
			},
			{ ...runtime, env: { CEAL_LEASED_CONSUMER_OPERATION_DEADLINE_MS: "1" } },
		),
		(error) => hasErrorCode(error) && error.code === "invalid_operation_deadline",
	);
	assert.equal(protectedReads, 0);

	await assert.rejects(
		consumeLeasedConsumerAttachmentStream(
			{
				request,
				expected_binding: binding,
				createHandoffRoot: () => {
					rootCalls += 1;
					return "/tmp/must-not-create";
				},
			},
			{
				...runtime,
				readProtectedSession: async () => encoder.encode(JSON.stringify({ schema_version: "wrong" })),
			},
		),
		(error) => hasErrorCode(error) && error.code === "session_unavailable",
	);
	assert.equal(protectedReads, 0);
	assert.equal(networkCalls, 0);
	assert.equal(rootCalls, 0);
});

test("candidate carrier closes an invalid response and cleans partial handoffs on stream proof failure", async () => {
	const cases = [
		{
			name: "wrong-content-type",
			contentType: "application/json",
			stream: chunked(new Uint8Array()),
			code: "invalid_response",
		},
		{
			name: "digest-drift",
			contentType: "application/octet-stream",
			stream: chunked(
				streamBytes(completeManifest(), [
					[0, Buffer.from("tampered")],
					[1, document],
				]),
			),
			code: "attachment_digest_mismatch",
		},
		{
			name: "truncated",
			contentType: "application/octet-stream",
			stream: chunked(
				streamBytes(
					completeManifest(),
					[
						[0, image],
						[1, document],
					],
					{ omit_terminal: true },
				),
			),
			code: "incomplete_attachment_stream",
		},
	];
	for (const current of cases) {
		let created: string | undefined;
		let responseCloses = 0;
		await assert.rejects(
			consumeLeasedConsumerAttachmentStream(
				{
					request,
					expected_binding: binding,
					createHandoffRoot: async () => {
						created = await mkdtemp(join(tmpdir(), `ceal-worker-carrier-${current.name}-`));
						return created;
					},
				},
				{
					env: {},
					readProtectedSession: async () => sessionBytes("/run/user/1001/ceal/gateway-candidate.sock"),
					closeProtectedSession: async () => {},
					requestUnixSocketStream: async () => ({
						status: 200,
						contentType: current.contentType,
						stream: current.stream,
						close: () => {
							responseCloses += 1;
						},
					}),
				},
			),
			(error) => hasErrorCode(error) && error.code === current.code,
		);
		assert.equal(responseCloses, 1, `${current.name} must release the response`);
		if (created !== undefined) await assert.rejects(stat(created), { code: "ENOENT" }, `${current.name} must remove partial handoff`);
	}
});

test("raw Unix-socket stream adapter returns body chunks and enforces its wall deadline", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "ceal-worker-attachment-transport-"));
	const socketPath = join(root, "attachment-stream.sock");
	const connections: Socket[] = [];
	const server = createServer((incoming, response) => {
		assert.equal(incoming.url, "/fixed-candidate-route");
		assert.equal(incoming.headers.authorization, "Bearer private-service-credential");
		response.writeHead(200, { "content-type": "application/octet-stream" });
		response.write(Buffer.from([1, 2]));
		response.end(Buffer.from([3, 4]));
	});
	server.on("connection", (socket) => connections.push(socket));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	t.after(async () => {
		for (const socket of connections) socket.destroy();
		await new Promise((resolve) => server.close(resolve));
		await rm(root, { recursive: true, force: true });
	});
	const response = await postUnixSocketStream({
		socketPath,
		path: "/fixed-candidate-route",
		method: "POST",
		credential: "private-service-credential",
		body: "{}",
		deadlineMs: 1_000,
		maximumResponseBytes: 16,
		errors: transportErrors(),
	});
	assert.deepEqual(await collect(response.stream), Buffer.from([1, 2, 3, 4]));
	response.close();

	const trickleRoot = await mkdtemp(join(tmpdir(), "ceal-worker-attachment-trickle-"));
	const tricklePath = join(trickleRoot, "attachment-stream.sock");
	const intervals: ReturnType<typeof setInterval>[] = [];
	const trickleConnections: Socket[] = [];
	const trickleServer = createServer((_incoming, trickleResponse) => {
		trickleResponse.writeHead(200, { "content-type": "application/octet-stream" });
		trickleResponse.write(Buffer.from([0]));
		intervals.push(setInterval(() => trickleResponse.write(Buffer.from([0])), 20));
	});
	trickleServer.on("connection", (socket) => trickleConnections.push(socket));
	await new Promise<void>((resolve, reject) => {
		trickleServer.once("error", reject);
		trickleServer.listen(tricklePath, resolve);
	});
	t.after(async () => {
		for (const interval of intervals) clearInterval(interval);
		for (const socket of trickleConnections) socket.destroy();
		await new Promise((resolve) => trickleServer.close(resolve));
		await rm(trickleRoot, { recursive: true, force: true });
	});
	const trickleResponse = await postUnixSocketStream({
		socketPath: tricklePath,
		path: "/fixed-candidate-route",
		method: "POST",
		credential: "private-service-credential",
		body: "{}",
		deadlineMs: 80,
		maximumResponseBytes: 16,
		errors: transportErrors(),
	});
	await assert.rejects(collect(trickleResponse.stream), /stream_deadline/u);
	trickleResponse.close();
});

test("the shipped bin dispatches the attachment-stream private token before public parsing", async () => {
	const binary = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
	const child = await runPrivateProcess(
		binary,
		LEASED_CONSUMER_ATTACHMENT_STREAM_ENTRYPOINT_ARGV,
		JSON.stringify({
			schema_version: "ceal.worker_private_leased_consumer_attachment_stream_request.v1",
			request,
			expected_binding: binding,
			path: "/tmp/not-accepted",
		}),
	);
	assert.equal(child.status, 2, child.stderr);
	assert.equal(child.stderr, "");
	assert.deepEqual(JSON.parse(child.stdout), {
		schema_version: "ceal.worker_private_leased_consumer_attachment_stream_result.v1",
		ok: false,
		status: "error",
		error_code: "invalid_request",
	});
});

function sessionBytes(socketPath: string): Uint8Array {
	return encoder.encode(
		JSON.stringify({
			schema_version: "ceal.leased_consumer_control_session.v1",
			transport: "unix_socket",
			socket_path: socketPath,
			service_credential: "private-service-credential",
		}),
	);
}

function transportErrors(): UnixSocketErrorNames {
	return {
		aborted: "stream_aborted",
		deadlineExceeded: "stream_deadline",
		responseTooLarge: "stream_too_large",
		responseFailed: "stream_response_failed",
		requestFailed: "stream_request_failed",
	};
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

function runPrivateProcess(
	binary: string,
	argv: string,
	input: string,
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
	return new Promise((resolve, reject) => {
		const devNull = openSync("/dev/null", "r");
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(process.execPath, [binary, argv], { stdio: ["pipe", "pipe", "pipe", devNull, devNull] });
		} finally {
			closeSync(devNull);
		}
		assert.ok(child.stdout);
		assert.ok(child.stderr);
		assert.ok(child.stdin);
		const childStdout = child.stdout;
		const childStderr = child.stderr;
		const childStdin = child.stdin;
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("leased consumer attachment-stream child timed out"));
		}, 5_000);
		childStdout.setEncoding("utf8");
		childStderr.setEncoding("utf8");
		childStdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		childStderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (exitCode) => {
			clearTimeout(timeout);
			resolve({ status: exitCode, stdout, stderr });
		});
		childStdin.end(input);
	});
}

type AttachmentStreamRequest = Parameters<NonNullable<LeasedConsumerAttachmentStreamCarrierRuntime["requestUnixSocketStream"]>>[0];

function hasErrorCode(error: unknown): error is { readonly code: string } {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string";
}

assert.equal(LEASED_CONSUMER_ATTACHMENT_STREAM_ROUTE_SHA256.length, 64);
assert.equal(LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_SHA256.length, 64);
assert.match(LEASED_CONSUMER_ATTACHMENT_STREAM_CONTRACT_JSON, /ceal[.]worker_private_leased_consumer_attachment_stream_contract[.]v1/u);
