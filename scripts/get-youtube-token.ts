// Run on your own computer, once (and again if the token is ever revoked):
//
//   npx tsx scripts/get-youtube-token.ts
//
// Asks for the OAuth client ID and secret of a "Desktop app" OAuth client
// (README → "YouTube", step 3), opens Google's consent page, and prints the
// refresh token to store as the YT_REFRESH_TOKEN secret. Sign in with the
// Google account that owns the YouTube channel (or a Brand Account manager:
// pick the channel when Google asks).
//
// You can also pass YT_CLIENT_ID and YT_CLIENT_SECRET as environment variables.
import { randomBytes } from "node:crypto";
import { ask, listening, waitForRedirect, netFetch } from "./lib/oauth-local.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  // Only so the workflow can show the channel name in its credentials check.
  "https://www.googleapis.com/auth/youtube.readonly",
];

async function main(): Promise<void> {
  const clientId = await ask("OAuth client ID: ", "YT_CLIENT_ID");
  const clientSecret = await ask("OAuth client secret: ", "YT_CLIENT_SECRET");
  const port = await listening(0);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = randomBytes(16).toString("hex");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    state,
  }).toString();

  console.log(`\nOpen this link, sign in with the channel's Google account and allow access:\n\n${url}\n`);
  const { query } = await waitForRedirect(port, "/callback");
  if (query.get("state") !== state) throw new Error("State mismatch; start again.");
  const code = query.get("code");
  if (!code) throw new Error(`Google returned: ${query.get("error") ?? "no code"}`);

  const res = await netFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!data.refresh_token) throw new Error(`No refresh token: ${data.error ?? ""} ${data.error_description ?? ""}`);

  console.log("\nStore this as the YT_REFRESH_TOKEN secret (gh secret set YT_REFRESH_TOKEN --repo <owner>/<app>):\n");
  console.log(data.refresh_token);
  console.log(
    '\nIf your OAuth consent screen is still in "Testing", this token stops working after 7 days. Publish the app first (README → "YouTube", step 4).',
  );
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
