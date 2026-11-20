// Run on your own computer to turn a short-lived User token from the Graph
// API Explorer into a Page access token that doesn't expire:
//
//   npx tsx scripts/get-facebook-token.ts
//
// Needs your Meta app's App ID and App Secret (App settings → Basic) and a
// User token with pages_show_list, pages_read_engagement, pages_manage_posts
// (README → "Facebook Page", step 3). Prints FB_PAGE_ID and FB_PAGE_TOKEN for
// each Page you manage. You can pass FB_APP_ID / FB_APP_SECRET / FB_USER_TOKEN as env vars.
import { ask, netFetch } from "./lib/oauth-local.ts";

const VERSION = process.env.FB_GRAPH_VERSION ?? "v24.0";

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await netFetch(`https://graph.facebook.com/${VERSION}/${path}?${new URLSearchParams(params)}`);
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || data.error) throw new Error(`Graph API: ${data.error?.message ?? res.status}`);
  return data;
}

async function main(): Promise<void> {
  const appId = await ask("Meta App ID: ", "FB_APP_ID");
  const appSecret = await ask("Meta App Secret: ", "FB_APP_SECRET");
  const userToken = await ask("Short-lived User token (from the Graph API Explorer): ", "FB_USER_TOKEN");

  // 1. Short-lived user token (~1 hour) → long-lived user token (~60 days).
  const long = await graph<{ access_token: string }>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: userToken,
  });

  // 2. Page tokens fetched with a long-lived user token don't expire.
  type Page = { id: string; name: string; access_token?: string; tasks?: string[] };
  const token = long.access_token;
  const pages: Page[] = (
    await graph<{ data: Page[] }>("me/accounts", { access_token: token, fields: "id,name,access_token,tasks" })
  ).data;

  // Pages run from a business portfolio (Meta Business Suite) or the new
  // Pages experience often aren't listed under me/accounts: find them through
  // the businesses, or by the Page ID, and ask each Page for its token.
  if (pages.length === 0) {
    const ids = new Set<string>();
    try {
      const businesses = await graph<{ data: { id: string }[] }>("me/businesses", { access_token: token });
      for (const b of businesses.data) {
        for (const edge of ["owned_pages", "client_pages"]) {
          const list = await graph<{ data: { id: string }[] }>(`${b.id}/${edge}`, { access_token: token, fields: "id" });
          for (const p of list.data) ids.add(p.id);
        }
      }
    } catch {
      // No business_management permission: fall back to asking for the ID.
    }
    if (ids.size === 0) {
      console.log("\nme/accounts lists no Pages (normal for Pages in a business portfolio).");
      const id = await ask("Page ID (Page → About → Page transparency → Page ID): ", "FB_PAGE_ID");
      if (id) ids.add(id);
    }
    for (const id of ids) {
      try {
        pages.push(await graph<Page>(id, { access_token: token, fields: "id,name,access_token,tasks" }));
      } catch (err) {
        console.log(`  Page ${id}: ${(err as Error).message}`);
      }
    }
  }

  if (pages.length === 0 || pages.every((p) => !p.access_token)) {
    const perms = await graph<{ data: { permission: string; status: string }[] }>("me/permissions", { access_token: token });
    const granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
    throw new Error(
      `No Page token. The token has: ${granted.join(", ") || "no permissions"}. It needs pages_show_list, pages_read_engagement, pages_manage_posts (and business_management for a Page in a business portfolio), the Page ticked in the login popup, and Full control of the Page (Meta Business Suite → Settings → People).`,
    );
  }

  for (const page of pages) {
    if (!page.access_token) {
      console.log(`\n${page.name}: no token (this account lacks Full control of the Page).`);
      continue;
    }
    const debug = await graph<{ data: { expires_at?: number } }>("debug_token", {
      input_token: page.access_token,
      access_token: `${appId}|${appSecret}`,
    });
    const expires = debug.data.expires_at ? new Date(debug.data.expires_at * 1000).toISOString() : "never";
    console.log(`\n${page.name}  (expires: ${expires})`);
    console.log(`FB_PAGE_ID=${page.id}`);
    console.log(`FB_PAGE_TOKEN=${page.access_token}`);
    if (page.tasks && !page.tasks.includes("CREATE_CONTENT")) {
      console.log("  ⚠ You can't create content on this Page with this account.");
    }
  }
  console.log("\nStore the two values of your Page as secrets in each app repo. Don't share the token.");
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
