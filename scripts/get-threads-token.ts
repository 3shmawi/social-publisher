// Run on your own computer to connect a Threads account:
//
//   npx tsx scripts/get-threads-token.ts
//
// Needs the Threads app ID and secret (Meta for Developers → your app →
// Use cases → Access the Threads API → Settings). Add the callback page as a
// redirect callback URL there:
//   https://3shmawi.github.io/social-publisher/oauth/callback.html
// Opens Threads' sign-in; the callback page then shows a one-time code to
// paste here. Prints THREADS_USER_ID and a long-lived THREADS_TOKEN (60
// days; the weekly credential check refreshes it, docs/threads.md).
// You can pass THREADS_APP_ID / THREADS_APP_SECRET as env vars. With
// THREADS_TOKEN_FILE=<path> the token is written there instead of printed.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ask, netFetch } from "./lib/oauth-local.ts";

const REDIRECT_URI =
  process.env.THREADS_REDIRECT_URI ?? "https://3shmawi.github.io/social-publisher/oauth/callback.html";
// Insights is used by the 7-day report (docs/reference.md → Insights).
const SCOPES = process.env.THREADS_SCOPES ?? "threads_basic,threads_content_publish,threads_manage_insights";

async function main(): Promise<void> {
  const appId = await ask("Threads app ID: ", "THREADS_APP_ID");
  const appSecret = await ask("Threads app secret: ", "THREADS_APP_SECRET");
  const state = randomBytes(16).toString("hex");

  const url = new URL("https://threads.net/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    response_type: "code",
    state,
  }).toString();
  console.log("\nStep 1 — Open this link, sign in to the Threads account that should post, and allow access:\n");
  console.log(`${url}\n`);
  console.log("Step 2 — The page that opens shows a code. Copy it and paste it here.\n");
  const pasted = await ask("Code: ");
  const [rawCode = "", returnedState = ""] = pasted.split("|");
  if (returnedState !== state) {
    throw new Error("That code is from a different sign-in (state mismatch). Run the script again and use the new link.");
  }
  // Threads appends "#_" to the code in the redirect.
  const code = decodeURIComponent(rawCode).replace(/#_$/, "");

  const short = await netFetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  const shortToken = (await short.json()) as { access_token?: string; user_id?: number | string; error_message?: string };
  if (!shortToken.access_token) throw new Error(`No token: ${shortToken.error_message ?? short.status}`);

  // Exchange the 1-hour token for a 60-day one.
  const exchange = new URL("https://graph.threads.net/access_token");
  exchange.search = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: appSecret,
    access_token: shortToken.access_token,
  }).toString();
  const long = await netFetch(exchange.toString(), {});
  const longToken = (await long.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!longToken.access_token) throw new Error(`No long-lived token: ${longToken.error?.message ?? long.status}`);

  const me = await netFetch("https://graph.threads.net/v1.0/me?fields=id,username", {
    headers: { Authorization: `Bearer ${longToken.access_token}` },
  });
  const profile = me.ok ? ((await me.json()) as { id?: string; username?: string }) : {};
  const days = Math.round((longToken.expires_in ?? 0) / 86400);

  console.log(`\nConnected @${profile.username ?? "?"}. Store these as secrets in each app repo:\n`);
  console.log(`THREADS_USER_ID:\n${profile.id ?? shortToken.user_id ?? ""}\n`);
  if (process.env.THREADS_TOKEN_FILE) {
    writeFileSync(process.env.THREADS_TOKEN_FILE, `${longToken.access_token}\n`, { mode: 0o600 });
    console.log(`THREADS_TOKEN (valid ${days} days): written to ${process.env.THREADS_TOKEN_FILE}\n`);
  } else {
    console.log(`THREADS_TOKEN (valid ${days} days):\n${longToken.access_token}\n`);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
