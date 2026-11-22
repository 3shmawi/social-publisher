// Run on your own computer to connect the Mohager TikTok account:
//
//   npx tsx scripts/get-tiktok-token.ts
//
// Needs the app's Client key and Client secret (TikTok for Developers →
// your app, or its Sandbox). Opens TikTok's sign-in (Login Kit); after you
// allow it, the callback page (https://3shmawi.github.io/social-publisher/
// oauth/callback.html, registered as the app's redirect URI) shows a
// one-time code: paste it here. Prints TIKTOK_REFRESH_TOKEN (~180 days)
// and the connected account.
//
// TikTok rotates refresh tokens: the workflow saves the new one after each
// run (SOCIAL_SECRETS_TOKEN), so only run this again if it says so.
// You can pass TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET as env vars. With
// TIKTOK_TOKEN_FILE=<path> the token is written there instead of printed
// (use it when recording the screen).
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ask, netFetch } from "./lib/oauth-local.ts";

const REDIRECT_URI =
  process.env.TIKTOK_REDIRECT_URI ?? "https://3shmawi.github.io/social-publisher/oauth/callback.html";
// Scope A: sign-in + upload to the inbox as a draft.
const SCOPES = process.env.TIKTOK_SCOPES ?? "user.info.basic,video.upload";

async function main(): Promise<void> {
  const clientKey = await ask("TikTok Client key: ", "TIKTOK_CLIENT_KEY");
  const clientSecret = await ask("TikTok Client secret: ", "TIKTOK_CLIENT_SECRET");
  const state = randomBytes(16).toString("hex");

  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPES,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state,
    disable_auto_auth: "1", // always show the consent screen (clear in the demo video)
  }).toString();

  console.log("\nStep 1 — Sign in with TikTok. Open this link, log in to the Mohager TikTok account and tap Authorize:\n");
  console.log(`${url}\n`);
  console.log("Step 2 — The page that opens shows a code. Copy it and paste it here.\n");
  const pasted = await ask("Code: ");
  const [code = "", returnedState = ""] = pasted.split("|");
  if (returnedState !== state) {
    throw new Error("That code is from a different sign-in (state mismatch). Run the script again and use the new link.");
  }

  const res = await netFetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: decodeURIComponent(code),
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });
  const token = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    refresh_expires_in?: number;
    open_id?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!token.access_token || !token.refresh_token) {
    throw new Error(`TikTok refused the code: ${token.error ?? res.status} ${token.error_description ?? ""}`);
  }

  // user.info.basic: show which account is connected.
  const me = await netFetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const info = (await me.json()) as { data?: { user?: { display_name?: string } } };
  const name = info.data?.user?.display_name ?? "unknown";

  const days = token.refresh_expires_in ? Math.round(token.refresh_expires_in / 86400) : 180;
  console.log(`\nConnected TikTok account: ${name}`);
  console.log(`Scopes granted: ${token.scope ?? SCOPES}\n`);
  if (process.env.TIKTOK_TOKEN_FILE) {
    // Screen-recording (the review's demo video): never show the token.
    writeFileSync(process.env.TIKTOK_TOKEN_FILE, token.refresh_token, { mode: 0o600 });
    console.log(`Saved TIKTOK_REFRESH_TOKEN (valid ${days} days) to ${process.env.TIKTOK_TOKEN_FILE}.`);
  } else {
    console.log(`Store this as the TIKTOK_REFRESH_TOKEN secret (valid ${days} days):\n`);
    console.log(token.refresh_token);
  }
  console.log(
    "\nTikTok replaces it on every use: the workflow saves the new one itself (SOCIAL_SECRETS_TOKEN). Don't share it.",
  );
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
