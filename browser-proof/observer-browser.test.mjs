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
	assert.equal(await page.locator("#root .hero h2").textContent(), "Your Ceal activity, with its evidence boundaries.");
	await page.getByText("Ceal session is unavailable").waitFor();
	await page.getByText(/supporting local evidence/u).waitFor();
	await page.getByText("No locally recorded outcomes in this selected view").waitFor();
	await page.getByText("Activity history and monetary cost contracts are unavailable").waitFor();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "developer");
	assert.equal(await page.locator("html").getAttribute("data-mode"), null);

	await page.getByRole("button", { name: "Agent activity" }).click();
	await page.getByText("Runtime overview").waitFor();
	assert.equal(await page.getByText("0 visible sessions").count(), 2);
	await page.getByText("No token evidence in the bounded session view").waitFor();
	await page.getByRole("button", { name: "Overview" }).click();

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
	assert.equal(await page.locator("#root .hero h2").textContent(), "Your Ceal activity, with its evidence boundaries.");
	await page.getByText("profile:review-personal").waitFor();
	await page.getByText("9 available").waitFor();
	await page.getByText("6 read · 3 write").waitFor();
	await page.getByText("35 outcomes recorded locally").waitFor();
	assert.equal(await page.locator("button[data-receipt]").count(), 20);
	assert.equal(await page.locator(".activity-grid .day[role='img']").count(), 365);
	await page.getByText("At least this many receipt appends were lost").waitFor();
	const evidenceTop = await page.getByText("Activity history and monetary cost contracts are unavailable").boundingBox();
	const firstDetailTop = await page.locator("button[data-receipt]").first().boundingBox();
	assert.ok(evidenceTop && firstDetailTop && evidenceTop.y < firstDetailTop.y);
	await page.locator("#period").selectOption("30");
	await page.getByText("35 outcomes recorded locally").waitFor();
	assert.equal(await page.locator("button[data-receipt]").count(), 20);
	const firstReceipt = page.locator("button[data-receipt]").first();
	await firstReceipt.focus();
	await page.keyboard.press("Enter");
	await page.getByRole("dialog").waitFor();
	await page.getByText("Ceal call evidence").waitFor();
	await page.keyboard.press("Escape");
	await firstReceipt.waitFor();
	assert.equal(await firstReceipt.evaluate((element) => element === document.activeElement), true);

	await page.getByRole("button", { name: "Agent activity" }).click();
	await page.getByText("4 visible sessions").waitFor();
	await page.getByText("3 visible sessions").waitFor();
	await page.getByText("3 with event evidence · 2 with token evidence").waitFor();
	await page.getByText("2 with event evidence · 1 with token evidence").waitFor();
	assert.equal(await page.getByText(/partial inventory/u).count(), 2);
	assert.equal(await page.getByText(/Token accounting from different runtimes/u).count(), 1);

	for (const theme of ["developer", "editorial", "terminal"]) {
		await page.locator("#theme").selectOption(theme);
		for (const mode of ["Auto", "Light", "Dark"]) {
			await page.getByRole("button", { name: mode }).click();
			assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
			assert.equal(await page.locator("html").getAttribute("data-mode"), mode === "Auto" ? null : mode.toLowerCase());
			await page.getByText(/Token accounting from different runtimes/u).waitFor();
			assert.equal(await page.getByText("4 visible sessions").count(), 1);
		}
	}
	await page.getByRole("button", { name: "Overview" }).focus();
	await page.keyboard.press("Enter");
	await page.getByText("35 outcomes recorded locally").waitFor();
	await page.getByText("Activity history and monetary cost contracts are unavailable").waitFor();
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
	await page.getByRole("button", { name: "Agent activity" }).click();
	await page.getByText("Runtime overview is unavailable").waitFor();
	await page.getByText("Missing sessions are not rendered as zero").waitFor();
	assert.equal(await page.getByText(/visible sessions/u).count(), 0);
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
