import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const AUTH_CLAIM = "https://api.openai.com/auth";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

type UsageWindow = {
	usedPercent: number;
	resetAt: number;
};

export function accountIdFromToken(token: string): string {
	const payload = token.split(".")[1];
	if (!payload) throw new Error("Invalid ChatGPT access token");

	try {
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		const accountId = claims?.[AUTH_CLAIM]?.chatgpt_account_id;
		if (typeof accountId === "string" && accountId) return accountId;
	} catch {
		// Use the stable error below.
	}
	throw new Error("ChatGPT account ID is missing from the access token");
}

function usageWindow(value: unknown): (UsageWindow & { duration: number }) | undefined {
	if (!value || typeof value !== "object") return;
	const window = value as Record<string, unknown>;
	const usedPercent = window.used_percent;
	const duration = window.limit_window_seconds;
	const resetAt = window.reset_at;
	if (![usedPercent, duration, resetAt].every((item) => typeof item === "number" && Number.isFinite(item))) return;
	return { usedPercent: usedPercent as number, duration: duration as number, resetAt: resetAt as number };
}

export function weeklyWindow(payload: unknown): UsageWindow | undefined {
	if (!payload || typeof payload !== "object") return;
	const rateLimit = (payload as Record<string, unknown>).rate_limit;
	if (!rateLimit || typeof rateLimit !== "object") return;
	const windows = rateLimit as Record<string, unknown>;
	const weekly = [windows.primary_window, windows.secondary_window]
		.map(usageWindow)
		.find((window) => window && Math.abs(window.duration - WEEK_SECONDS) <= WEEK_SECONDS * 0.05);
	return weekly && { usedPercent: weekly.usedPercent, resetAt: weekly.resetAt };
}

function percent(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("codex-usage", {
		description: "Show ChatGPT Codex weekly usage and reset time",
		handler: async (_args, ctx) => {
			ctx.ui.setStatus("pi-codex-usage", ctx.ui.theme.fg("dim", "Codex usage: fetching…"));
			try {
				const token = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
				if (!token) throw new Error("No ChatGPT login found. Run /login and choose OpenAI Codex.");

				// ponytail: internal endpoint; replace with a public usage API if OpenAI exposes one.
				const response = await fetch(USAGE_URL, {
					headers: {
						Authorization: `Bearer ${token}`,
						"chatgpt-account-id": accountIdFromToken(token),
						originator: "pi",
						Accept: "application/json",
					},
					signal: AbortSignal.timeout(15_000),
				});
				if (!response.ok) throw new Error(`ChatGPT usage request failed (${response.status})`);

				const window = weeklyWindow(await response.json());
				if (!window) throw new Error("ChatGPT did not return a weekly Codex usage window");
				const used = Math.min(100, Math.max(0, window.usedPercent));
				const reset = new Intl.DateTimeFormat(undefined, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(new Date(window.resetAt * 1000));
				const summary = `${percent(used)}% used · resets ${reset}`;

				ctx.ui.setStatus("pi-codex-usage", ctx.ui.theme.fg("dim", `Codex weekly: ${summary}`));
				ctx.ui.notify(`ChatGPT Codex weekly usage: ${summary}\n${percent(100 - used)}% remaining`, "info");
			} catch (error) {
				ctx.ui.setStatus("pi-codex-usage", undefined);
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
