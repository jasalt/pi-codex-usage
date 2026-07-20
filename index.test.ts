import assert from "node:assert/strict";
import test from "node:test";
import { accountIdFromToken, weeklyWindow } from "./index.ts";

const jwt = (payload: object) =>
	`header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;

test("extracts the ChatGPT account ID", () => {
	assert.equal(
		accountIdFromToken(jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })),
		"acct-1",
	);
});

test("finds a weekly secondary usage window", () => {
	assert.deepEqual(
		weeklyWindow({
			rate_limit: {
				primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_at: 100 },
				secondary_window: { used_percent: 42, limit_window_seconds: 604_800, reset_at: 200 },
			},
		}),
		{ usedPercent: 42, resetAt: 200 },
	);
});
