// The weekly credential check, run as a script against fakes of the GitHub
// API (issues) and the Bluesky API: a failing check opens the issue, a
// second failure updates it, a passing check closes it.
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { report } from "../scripts/health.ts";

const root = path.resolve(import.meta.dirname, "..");
let server: Server;
let base = "";
let blueskyOk = false;
const issues: { number: number; state: string; body: string; labels: string[]; comments: string[] }[] = [];

function runHealth(): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "scripts/health.ts"], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_API_URL: base,
        GITHUB_REPOSITORY: "me/cafe",
        GITHUB_TOKEN: "test",
        PLATFORMS: "bluesky",
        BLUESKY_SERVICE: base,
        BLUESKY_HANDLE: "cafe.bsky.social",
        BLUESKY_APP_PASSWORD: "pw",
      },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stdout += d));
    child.on("close", (status) => resolve({ status, stdout }));
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = req.url ?? "";
      const json = (o: unknown, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(o));
      if (url === "/xrpc/com.atproto.server.createSession") {
        return blueskyOk
          ? json({ accessJwt: "j", did: "did:plc:x", handle: "cafe.bsky.social" })
          : json({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401);
      }
      if (req.method === "GET" && url.startsWith("/repos/me/cafe/issues?")) {
        return json(issues.filter((i) => i.state === "open").map((i) => ({ number: i.number, html_url: `https://github.com/me/cafe/issues/${i.number}`, title: "t" })));
      }
      if (req.method === "POST" && url === "/repos/me/cafe/issues") {
        const body = JSON.parse(raw) as { body: string; labels: string[] };
        const issue = { number: issues.length + 1, state: "open", body: body.body, labels: body.labels, comments: [] };
        issues.push(issue);
        return json({ number: issue.number, html_url: `https://github.com/me/cafe/issues/${issue.number}`, title: "t" }, 201);
      }
      const m = /^\/repos\/me\/cafe\/issues\/(\d+)(\/comments)?$/.exec(url);
      if (m) {
        const issue = issues[Number(m[1]) - 1]!;
        const body = JSON.parse(raw) as { body?: string; state?: string };
        if (m[2]) issue.comments.push(body.body ?? "");
        else {
          if (body.body) issue.body = body.body;
          if (body.state) issue.state = body.state;
        }
        return json({ number: issue.number, html_url: "x", title: "t" });
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe("weekly credential check", () => {
  it("opens one labelled issue when a platform would fail", async () => {
    const result = await runHealth();
    expect(result.status).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.labels).toEqual(["social-credentials"]);
    expect(issues[0]!.body).toContain("app password was refused");
  }, 60_000);

  it("updates the same issue the next week instead of opening another", async () => {
    await runHealth();
    expect(issues).toHaveLength(1);
  }, 60_000);

  it("closes the issue once everything works", async () => {
    blueskyOk = true;
    const result = await runHealth();
    expect(result.status).toBe(0);
    expect(issues[0]!.state).toBe("closed");
    expect(issues[0]!.comments[0]).toContain("everything works again");
  }, 60_000);

  it("reports each platform in a table", () => {
    const md = report(
      [
        { platform: "facebook", ok: true, detail: 'page "Cafe"' },
        { platform: "x", ok: false, detail: "X: the keys were refused | regenerate" },
      ],
      "me/cafe",
    );
    expect(md).toContain("**1 platform would fail to post**");
    expect(md).toContain("| x | ❌ X: the keys were refused \\| regenerate |");
  });
});
