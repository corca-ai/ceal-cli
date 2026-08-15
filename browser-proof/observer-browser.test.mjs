import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

test("a real browser executes the local Workbench overview", { timeout: 20_000 }, async (context) => {
	const home = mkdtempSync(path.join(tmpdir(), "ceal-browser-home-"));
	context.after(() => rmSync(home, { recursive: true, force: true }));
	const server = spawn(process.execPath, ["packages/ceal-worker-cli/dist/bin.js", "observe", "--port", "0"], {
		env: {
			HOME: home,
			CODEX_HOME: path.join(home, "codex"),
			CLAUDE_CONFIG_DIR: path.join(home, "claude"),
			PATH: process.env.PATH ?? "",
			TMPDIR: process.env.TMPDIR ?? tmpdir(),
			LANG: "C.UTF-8",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	context.after(async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGTERM");
			await once(server, "exit");
		}
	});
	const url = await observerUrl(server);
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	const pageErrors = [];
	const requests = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));

	await page.goto(url);
	await page.locator("#root .hero").waitFor();
	assert.deepEqual(pageErrors, []);
	assert.equal(await page.locator("#root .hero h2").textContent(), "0 sessions observed.");
	await page.getByText("Local Profile unavailable").waitFor();
	await page.getByText(/Local runtime evidence/u).waitFor();
	await page.getByRole("button", { name: /Estimated cost Unavailable/u }).click();
	await page.getByRole("heading", { name: "Estimated cost is unsupported." }).waitFor();
	assert.equal(await page.locator("button[data-metric='estimated_cost']").evaluate((element) => element === document.activeElement), true);
	assert.equal(await page.locator("html").getAttribute("data-theme"), "developer");
	assert.equal(await page.locator("html").getAttribute("data-mode"), null);

	await page.getByRole("button", { name: "Sessions", exact: true }).click();
	await page.getByText("No sessions observed in the selected window").waitFor();
	await page.getByRole("button", { name: "Access", exact: true }).click();
	await page.getByText("Capability access unavailable").waitFor();
	await page.getByRole("button", { name: "Usage", exact: true }).click();

	await page.locator("#theme").selectOption("terminal");
	await page.getByRole("button", { name: "Dark" }).click();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "terminal");
	assert.equal(await page.locator("html").getAttribute("data-mode"), "dark");

	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal((await page.locator("body").boundingBox())?.width, 390);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
	assert.ok(requests.length > 0);
	assert.ok(requests.every(isLoopbackGet));
});

test("a populated review fixture preserves density and evidence boundaries", { timeout: 20_000 }, async (context) => {
	const server = spawn(process.execPath, ["browser-proof/populated-observer.mjs"], {
		env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: "C.UTF-8" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	context.after(async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGTERM");
			await once(server, "exit");
		}
	});
	const url = await observerUrl(server);
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	const pageErrors = [];
	const requests = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));

	await page.goto(url);
	await page.locator("#root .hero").waitFor();
	assert.equal(await page.locator("#root .hero h2").textContent(), "3 sessions observed.");
	await page.getByText("Local Profile unavailable").waitFor();
	await page.getByText("ceal.local_usage_rules v1").first().waitFor();
	await page.getByText(/not model judgment or a productivity score/u).waitFor();
	await page.getByRole("button", { name: "Claude", exact: true }).click();
	await page.getByText(/claude:session_inventory:v1/u).waitFor();
	await page.getByRole("button", { name: /Tokens/u }).click();
	await page.getByText(/claude:event_usage_sum:v1/u).waitFor();
	assert.equal(await page.locator("button[data-metric='tokens']").getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: "Codex", exact: true }).click();
	await page.getByText(/codex:runtime_cumulative_last:v1/u).waitFor();
	assert.equal(await page.locator("button[data-metric='tokens']").getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: "Claude", exact: true }).click();
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-runtime")), "claude");
	await page.getByRole("button", { name: "Sessions", exact: true }).click();
	assert.equal(await page.locator("button[data-session-ref]").count(), 4);
	assert.equal(await page.locator("button[data-session-ref]").filter({ hasNotText: "claude session" }).count(), 0);
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	assert.equal(await page.getByRole("button", { name: "Claude", exact: true }).getAttribute("aria-pressed"), "true");
	assert.equal(await page.locator("button[data-metric='tokens']").getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: /Estimated cost Unavailable/u }).click();
	await page.getByRole("heading", { name: "Estimated cost is unsupported." }).waitFor();
	await page.getByRole("button", { name: "Codex", exact: true }).click();
	await page.locator("button[data-metric='sessions']").click();
	assert.equal(await page.locator(".activity-grid .day[role='img']").count(), 3);
	await page.getByRole("button", { name: /Estimated cost USD/u }).click();
	await page.getByText(/Estimated locally; not billed cost/u).waitFor();
	await page.getByText(/observed of 3 eligible sessions/u).waitFor();
	await page.getByRole("button", { name: /Tokens/u }).click();
	await page.getByText(/observed of 3 eligible sessions/u).waitFor();

	await page.getByRole("button", { name: "Sessions", exact: true }).click();
	assert.equal(await page.locator("button[data-session-ref]").count(), 3);
	await page.getByText(/Model gpt-review-codex/u).waitFor();
	await page
		.getByText(/Model unavailable/u)
		.first()
		.waitFor();
	const firstSession = page.locator("button[data-session-ref]").first();
	await firstSession.focus();
	await page.keyboard.press("Enter");
	await page.getByRole("dialog").waitFor();
	await page.getByText("Agent session evidence").waitFor();
	await page.keyboard.press("Escape");
	await firstSession.waitFor();
	assert.equal(await firstSession.evaluate((element) => element === document.activeElement), true);
	await page.getByRole("button", { name: "Access", exact: true }).click();
	await page.getByText("9", { exact: true }).first().waitFor();
	await page.getByRole("heading", { name: "Review capability 1" }).waitFor();
	await page.getByText("message.search.1", { exact: true }).waitFor();
	await page.getByText("Resource target: required · Audit evidence: gateway_audit", { exact: true }).first().waitFor();
	assert.equal(await page.getByText("Review capability 9", { exact: true }).count(), 1);
	await page.getByText("Request access").waitFor();
	assert.equal(await page.getByRole("button", { name: "Request access" }).isDisabled(), true);

	for (const theme of ["developer", "editorial", "terminal"]) {
		await page.locator("#theme").selectOption(theme);
		for (const mode of ["Auto", "Light", "Dark"]) {
			await page.getByRole("button", { name: mode }).click();
			assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
			assert.equal(await page.locator("html").getAttribute("data-mode"), mode === "Auto" ? null : mode.toLowerCase());
			await page.getByText("Gateway-observed capability summary.").waitFor();
		}
	}
	await page.getByRole("button", { name: "Usage", exact: true }).focus();
	await page.keyboard.press("Enter");
	await page.getByText(/tokens observed[.]/u).waitFor();
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.locator("html").getAttribute("data-theme"), "terminal");
	assert.equal(await page.locator("html").getAttribute("data-mode"), "dark");
	assert.equal((await page.locator("body").boundingBox())?.width, 390);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
	assert.deepEqual(pageErrors, []);
	assert.ok(requests.length > 0);
	assert.ok(requests.every(isLoopbackGet));
});

test("the browser distinguishes unavailable Agent inventory from zero sessions", { timeout: 20_000 }, async (context) => {
	const server = spawn(process.execPath, ["browser-proof/populated-observer.mjs"], {
		env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: "C.UTF-8", CEAL_REVIEW_AGENT_UNAVAILABLE: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	context.after(async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGTERM");
			await once(server, "exit");
		}
	});
	const url = await observerUrl(server);
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage();
	await page.goto(url);
	await page.getByRole("heading", { name: "Sessions is unavailable." }).waitFor();
	await page.getByText("Missing evidence is not rendered as zero").waitFor();
	await page.getByRole("button", { name: "Sessions", exact: true }).click();
	await page.getByText("Session inventory is unavailable").waitFor();
	await page.getByText("No zero-session claim is made.").waitFor();
});

test("more than one hundred sessions use bounded pagination", { timeout: 20_000 }, async (context) => {
	const server = spawn(process.execPath, ["browser-proof/populated-observer.mjs"], {
		env: {
			PATH: process.env.PATH ?? "",
			TMPDIR: process.env.TMPDIR ?? tmpdir(),
			LANG: "C.UTF-8",
			CEAL_REVIEW_MANY_SESSIONS: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	context.after(async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGTERM");
			await once(server, "exit");
		}
	});
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
	await page.goto(await observerUrl(server));
	await page.getByRole("button", { name: "Sessions", exact: true }).click();
	await page.getByText("Page 1 of 6 · 105 of 105 eligible sessions returned").waitFor();
	assert.equal(await page.locator("button[data-session-ref]").count(), 20);
	await page.getByRole("button", { name: "Next" }).click();
	await page.getByText("Page 2 of 6 · 105 of 105 eligible sessions returned").waitFor();
	assert.equal(await page.locator("button[data-session-ref]").count(), 20);
	assert.equal(await page.getByRole("button", { name: "Next" }).evaluate((element) => element === document.activeElement), true);
	for (let pageNumber = 3; pageNumber <= 6; pageNumber += 1) await page.getByRole("button", { name: "Next" }).click();
	await page.getByText("Page 6 of 6 · 105 of 105 eligible sessions returned").waitFor();
	assert.equal(await page.locator("button[data-session-ref]").count(), 5);
	assert.equal(await page.getByRole("button", { name: "Next" }).isDisabled(), true);
	assert.equal(await page.getByRole("button", { name: "Previous" }).evaluate((element) => element === document.activeElement), true);
});

function isLoopbackGet(request) {
	const host = new URL(request.url).hostname;
	return request.method === "GET" && (host === "127.0.0.1" || host === "localhost" || host === "[::1]");
}

function observerUrl(child) {
	return new Promise((resolve, reject) => {
		let output = "";
		let stderr = "";
		let settled = false;
		const finish = (operation, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			operation(value);
		};
		const deadline = setTimeout(() => finish(reject, new Error(`observer did not listen; stderr: ${stderr}`)), 8_000);
		child.stdout.on("data", (chunk) => {
			output += chunk;
			const match = /^url: (http:\/\/127[.]0[.]0[.]1:\d+\/)$/mu.exec(output);
			if (match) finish(resolve, match[1]);
		});
		child.stderr.on("data", (chunk) => {
			stderr = `${stderr}${chunk}`.slice(-4_096);
		});
		child.once("exit", (code) => finish(reject, new Error(`observer exited before listening (${code}); stderr: ${stderr}`)));
		child.once("error", (error) => finish(reject, error));
	});
}
