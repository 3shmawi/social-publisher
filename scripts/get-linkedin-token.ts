// Run on your own computer to get a LinkedIn access token (and, for apps with
// the Community Management API, a refresh token):
//
//   npx tsx scripts/get-linkedin-token.ts
//
// First add this exact redirect URL to your LinkedIn app (Auth tab →
// Authorized redirect URLs): http://localhost:8585/callback
//
// Prints LINKEDIN_TOKEN (≈60 days), LINKEDIN_REFRESH_TOKEN when LinkedIn
// issues one (≈1 year), and your LINKEDIN_AUTHOR_URN.
// You can pass LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET / LINKEDIN_SCOPES as env vars.
import { randomBytes } from "node:crypto";
import { ask, waitForRedirect } from "./lib/oauth-local.ts";

const PORT = 8585;

async function main(): Promise<void> {
  const clientId = await ask("LinkedIn app Client ID: ", "LINKEDIN_CLIENT_ID");
  const clientSecret = await ask("LinkedIn app Client Secret: ", "LINKEDIN_CLIENT_SECRET");
  const scopes =
    process.env.LINKEDIN_SCOPES ??
    ((await ask("Also post as a company page? [Y/n] ")).toLowerCase().startsWith("n")
      ? "openid profile w_member_social"
      : "openid profile w_member_social w_organization_social r_organization_admin");
  const redirectUri = `http://localhost:${PORT}/callback`;
  const state = randomBytes(16).toString("hex");

  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
  }).toString();
  console.log(`\nOpen this link and allow access:\n\n${url}\n`);

  const { query } = await waitForRedirect(PORT, "/callback");
  if (query.get("state") !== state) throw new Error("State mismatch; start again.");
  const code = query.get("code");
  if (!code) throw new Error(`LinkedIn returned: ${query.get("error")} ${query.get("error_description") ?? ""}`);

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const token = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error_description?: string;
  };
  if (!token.access_token) throw new Error(`No token: ${token.error_description ?? res.status}`);

  const me = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = me.ok ? ((await me.json()) as { sub?: string; name?: string }) : {};

  const days = (s?: number) => (s ? `${Math.round(s / 86400)} days` : "unknown");
  console.log("\nStore these as secrets in each app repo:\n");
  console.log(`LINKEDIN_TOKEN (valid ${days(token.expires_in)}):\n${token.access_token}\n`);
  if (token.refresh_token) {
    console.log(`LINKEDIN_REFRESH_TOKEN (valid ${days(token.refresh_token_expires_in)}):\n${token.refresh_token}\n`);
    console.log("With the refresh token, also store LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.\n");
  }
  if (profile.sub) console.log(`LINKEDIN_AUTHOR_URN (${profile.name ?? "you"}):\nurn:li:person:${profile.sub}\n`);
  if (scopes.includes("r_organization_admin")) {
    const orgs = await fetch(
      "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
      {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "LinkedIn-Version": process.env.LINKEDIN_VERSION ?? "202609",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );
    if (orgs.ok) {
      const data = (await orgs.json()) as { elements?: { organization?: string }[] };
      const urns = (data.elements ?? []).map((e) => e.organization).filter(Boolean);
      console.log(`LINKEDIN_ORG_URN (pages you administer):\n${urns.join("\n") || "none found"}\n`);
    } else {
      console.log("Couldn't list your pages; find LINKEDIN_ORG_URN as README → LinkedIn, step 6 describes.\n");
    }
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
