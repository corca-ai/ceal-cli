import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

test("a real browser executes the local Workbench overview", { timeout: 45_000 }, async (context) => {
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
			server.kill("SIGKILL");
		}
	});
	const url = await observerUrl(server);
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
	const pageErrors = [];
	const requests = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));

	await page.goto(url);
	await page.locator("#root .hero").waitFor();
	assert.deepEqual(pageErrors, []);
	assert.equal(await page.locator("#root .hero h2").textContent(), "0 sessions observed.");
	await page.getByText("Local Profile unavailable").waitFor();
	await page.getByText(/Both runtimes use the same selected-period calendar/u).waitFor();
	await page.getByRole("button", { name: /Estimated cost Unavailable/u }).click();
	await page.getByRole("heading", { name: "Estimated cost · unsupported" }).waitFor();
	assert.equal(await page.locator("button[data-metric='estimated_cost']").evaluate((element) => element === document.activeElement), true);
	assert.equal(await page.locator("html").getAttribute("data-theme"), "developer");
	assert.equal(await page.locator("html").getAttribute("data-mode"), null);

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

test("a populated review fixture preserves density and evidence boundaries", { timeout: 40_000 }, async (context) => {
	const server = spawn(process.execPath, ["browser-proof/populated-observer.mjs"], {
		env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? tmpdir(), LANG: "C.UTF-8" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	context.after(async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGKILL");
		}
	});
	const url = await observerUrl(server);
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
	const pageErrors = [];
	const requests = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));

	await page.goto(url);
	await page.locator("#root .hero").waitFor();
	assert.equal(await page.locator("#root .hero h2").textContent(), "3 sessions observed.");
	await page.getByText("profile:review-personal", { exact: true }).waitFor();
	await page.getByText("ceal.local_usage_rules v2").first().waitFor();
	await page.getByText(/not model judgment or a productivity score/u).waitFor();
	await page.getByRole("button", { name: "Claude", exact: true }).click();
	await page
		.getByText(/claude:session_inventory:v1/u)
		.first()
		.waitFor();
	await page.getByRole("button", { name: "Review token coverage" }).click();
	await page.waitForFunction(() => document.querySelector("button[data-view='Evidence']")?.getAttribute("aria-current") === "true");
	assert.equal(await page.getByRole("button", { name: "Evidence", exact: true }).getAttribute("aria-current"), "true");
	assert.equal(
		await page.getByRole("button", { name: "Evidence", exact: true }).evaluate((element) => element === document.activeElement),
		true,
	);
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	await page.locator("button[data-metric='tokens']").click();
	await page
		.getByText(/claude:event_usage_sum:v1/u)
		.first()
		.waitFor();
	assert.equal(await page.locator("button[data-metric='tokens']").getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: "Codex", exact: true }).click();
	await page
		.getByText(/codex:runtime_cumulative_last:v1/u)
		.first()
		.waitFor();
	assert.equal(await page.locator("button[data-metric='tokens']").getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: "Claude", exact: true }).click();
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-runtime")), "claude");
	assert.equal(await page.locator("button[data-session-ref]").count(), 4);
	assert.equal(await page.locator("button[data-session-ref] .pill").filter({ hasText: "claude" }).count(), 4);
	assert.equal(await page.getByRole("button", { name: "Claude", exact: true }).getAttribute("aria-pressed"), "true");
	assert.equal(await page.locator("button[data-metric='tokens']").getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: /Estimated cost Unavailable/u }).click();
	await page.getByRole("heading", { name: "Estimated cost · unsupported" }).waitFor();
	await page.getByRole("button", { name: "Codex", exact: true }).click();
	await page.locator("button[data-metric='sessions']").click();
	assert.ok((await page.locator(".activity-grid button[data-activity-date]").count()) > 3);
	await page.getByRole("button", { name: /Estimated cost USD/u }).click();
	await page.getByText(/Estimated locally; not billed cost/u).waitFor();
	await page
		.getByText(/observed of 3 eligible sessions/u)
		.first()
		.waitFor();
	await page.locator("button[data-metric='tokens']").click();
	await page
		.getByText(/observed of 3 eligible sessions/u)
		.first()
		.waitFor();
	await page.getByText("Unavailable", { exact: true }).waitFor();
	assert.ok((await page.locator(".activity-grid .day.unavailable").count()) > 0);

	assert.equal(await page.locator("button[data-session-ref]").count(), 3);
	await page.getByText("gpt-review-codex", { exact: true }).first().waitFor();
	await page
		.getByText(/Model unknown/u)
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
	await page.getByRole("heading", { name: "Search messages" }).first().waitFor();
	await page.getByText("message.search.1", { exact: true }).waitFor();
	await page.getByText("Reads information without changing it · A resource target is required", { exact: true }).first().waitFor();
	assert.equal(await page.getByRole("heading", { name: "Search messages" }).count(), 3);
	await page.getByText("Request access").waitFor();
	assert.equal(await page.getByRole("button", { name: "Request access" }).isDisabled(), true);
	await page.locator("#language").selectOption("ko");
	await page.getByRole("heading", { name: "이 프로필로 Ceal에서 할 수 있는 일" }).waitFor();
	await page.getByRole("button", { name: "사용량", exact: true }).click();
	await page.getByText(/두 런타임은 같은 선택 기간의 달력을 사용합니다/u).waitFor();
	await page.getByText("관측값 0", { exact: true }).waitFor();
	await page.getByText("높음", { exact: true }).waitFor();
	await page.getByText("확인 불가", { exact: true }).first().waitFor();
	await page.getByText("합성 작업명", { exact: true }).first().waitFor();
	await page.getByRole("button", { name: "데이터 근거", exact: true }).click();
	await page.getByRole("heading", { name: "이 대시보드의 숫자를 어디까지 믿을 수 있는지" }).waitFor();
	await page.getByRole("heading", { name: "읽을 수 있는 로컬 기록" }).waitFor();
	await page.getByText("완료", { exact: true }).first().waitFor();
	await page.getByText("Gateway 조회로 확인", { exact: true }).first().waitFor();
	await page.getByText("완료 전 차단", { exact: true }).first().waitFor();
	await page.getByText("최종 결과 미확인", { exact: true }).first().waitFor();
	assert.equal(await page.getByText("activity_recorded_at", { exact: true }).count(), 0);
	assert.equal(await page.getByText("dropped_appends_are_a_floor", { exact: true }).count(), 0);
	await page.locator("#language").selectOption("en");
	await page.getByRole("button", { name: "Access", exact: true }).click();

	for (const theme of ["developer", "editorial", "terminal"]) {
		await page.locator("#theme").selectOption(theme);
		for (const mode of ["Auto", "Light", "Dark"]) {
			await page.getByRole("button", { name: mode }).click();
			assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
			assert.equal(await page.locator("html").getAttribute("data-mode"), mode === "Auto" ? null : mode.toLowerCase());
			await page.getByRole("heading", { name: "What this Profile can do through Ceal" }).waitFor();
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
			server.kill("SIGKILL");
		}
	});
	const url = await observerUrl(server);
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage();
	await page.goto(url);
	await page.getByRole("heading", { name: "Sessions · unavailable" }).waitFor();
	await page.getByText("Missing evidence is not rendered as zero").waitFor();
	await page.getByText("Session inventory · unavailable").waitFor();
	await page.getByText("No zero-session claim is made.").waitFor();
	await page.locator("#language").selectOption("ko");
	await page.getByRole("button", { name: "사용량", exact: true }).click();
	await page.getByRole("button", { name: /예상 비용 확인 불가/u }).click();
	await page.getByRole("heading", { name: "예상 비용 · 미지원" }).waitFor();
	await page.getByText("세션 목록 · 확인 불가").waitFor();
});

test("more than one hundred sessions use bounded pagination", { timeout: 40_000 }, async (context) => {
	const server = spawn(process.execPath, ["browser-proof/populated-observer.mjs"], {
		env: {
			PATH: process.env.PATH ?? "",
			TMPDIR: process.env.TMPDIR ?? tmpdir(),
			LANG: "C.UTF-8",
			CEAL_REVIEW_DEMO: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	context.after(async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGKILL");
		}
	});
	const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true });
	context.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
	const requests = [];
	page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
	await page.goto(await observerUrl(server));
	await page.getByText(/Synthetic demo data/u).waitFor();
	await page.getByRole("heading", { name: "105 sessions observed." }).waitFor();
	await page.getByRole("button", { name: /Agent tool calls 508/u }).waitFor();
	await page.getByText(/separate local sources and accounting semantics/u).waitFor();
	const selectedWindow = await page.evaluate(
		async () => (await (await fetch("/api/observer/v2/state")).json()).local_usage_dashboard.window,
	);
	const codexCalendarCellCount = await page.locator("button[data-activity-date]").count();
	const lastIncludedDate = new Date(`${selectedWindow.end_date}T00:00:00.000Z`);
	lastIncludedDate.setUTCDate(lastIncludedDate.getUTCDate() - 1);
	assert.equal(await page.locator("button[data-activity-date]").first().getAttribute("data-activity-date"), selectedWindow.start_date);
	assert.equal(
		await page.locator("button[data-activity-date]").last().getAttribute("data-activity-date"),
		lastIncludedDate.toISOString().slice(0, 10),
	);
	const activityDate = await page.locator("button[data-activity-date]").first().getAttribute("data-activity-date");
	await page.locator("button[data-activity-date]").first().click();
	assert.equal(await page.getByRole("button", { name: "Usage", exact: true }).getAttribute("aria-current"), "true");
	await page
		.getByText(new RegExp(`${activityDate} · \\d+ returned session details`, "u"))
		.first()
		.waitFor();
	await page.getByText(/not a complete count for the date/u).waitFor();
	await page.getByRole("button", { name: "Clear date filter" }).click();
	assert.equal(await page.locator("select[data-session-sort]").inputValue(), "tokens");
	await page.getByText("16,080 tokens", { exact: true }).first().waitFor();
	assert.equal(
		await page.locator("button[data-session-ref]").first().getAttribute("data-session-ref"),
		"22222222-2222-3333-4444-000000000114",
	);
	await page.locator("select[data-session-sort]").selectOption("tools");
	assert.equal(
		await page.locator("button[data-session-ref]").first().getAttribute("data-session-ref"),
		"22222222-2222-3333-4444-000000000050",
	);
	await page.locator("select[data-session-sort]").selectOption("recent");
	assert.equal(
		await page.locator("button[data-session-ref]").first().getAttribute("data-session-ref"),
		"22222222-2222-3333-4444-000000000010",
	);
	await page.locator("select[data-session-sort]").selectOption("tokens");
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	await page.getByText(/highest tool-call concentration/u).waitFor();
	await page.getByRole("button", { name: "Inspect the referenced session" }).first().focus();
	await page.keyboard.press("Enter");
	await page.getByRole("dialog").waitFor();
	await page.getByText("Agent session evidence").waitFor();
	assert.equal(await page.getByRole("button", { name: "Usage", exact: true }).getAttribute("aria-current"), "true");
	const referencedSession = page.locator("button[data-session-ref='22222222-2222-3333-4444-000000000050']");
	assert.equal(await referencedSession.count(), 1);
	await page.keyboard.press("Escape");
	assert.equal(await referencedSession.evaluate((element) => element === document.activeElement), true);
	await page.getByRole("button", { name: "Usage", exact: true }).click();
	await page.getByRole("button", { name: /Tokens 924,000/u }).waitFor();
	await page.getByRole("button", { name: /Estimated cost USD 3[.]36/u }).click();
	await page.getByText(/Estimated locally; not billed cost/u).waitFor();
	assert.equal(await page.locator(".activity-grid button[data-activity-date]").count(), codexCalendarCellCount);
	await page.getByText("profile:review-personal", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Claude", exact: true }).click();
	await page.locator("button[data-metric='sessions']").click();
	assert.equal(await page.locator("button[data-activity-date]").count(), codexCalendarCellCount);
	await page.getByRole("button", { name: "Codex", exact: true }).click();
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
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
	assert.ok(requests.length > 0);
	assert.ok(requests.every(isLoopbackGet));
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
