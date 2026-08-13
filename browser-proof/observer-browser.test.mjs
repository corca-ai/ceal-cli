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
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await page.goto(url);
	await page.locator("#root .hero").waitFor();
	assert.deepEqual(pageErrors, []);
	assert.equal(
		await page.locator("#root .hero h2").textContent(),
		"0 locally recorded outcomes are visible in this selected period of the retained window.",
	);
	await page.getByText("No locally recorded outcomes in this selected view").waitFor();
	await page.getByText("Correlated work and monetary cost are unsupported").waitFor();
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
});

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
