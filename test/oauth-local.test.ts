import { describe, expect, it } from "vitest";
import { listening, waitForRedirect } from "../scripts/lib/oauth-local.ts";

describe("local OAuth redirect", () => {
  it("returns the code and the port after the browser comes back", async () => {
    const port = await listening(0);
    const waiting = waitForRedirect(port, "/callback");
    const res = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=s1`);
    expect(res.status).toBe(200);
    const { query, port: got } = await waiting;
    expect(query.get("code")).toBe("abc");
    expect(got).toBe(port);
  });
});

describe("network errors in the token helpers", () => {
  it("names the host and the cause instead of 'fetch failed'", async () => {
    const { describeNetworkError } = await import("../scripts/lib/oauth-local.ts");
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET", message: "socket hang up" },
    });
    const text = describeNetworkError("oauth2.googleapis.com", err);
    expect(text).toContain("oauth2.googleapis.com");
    expect(text).toContain("ECONNRESET: socket hang up");
    expect(text).toContain("VPN");
  });

  it("points DNS failures at the connection", async () => {
    const { describeNetworkError } = await import("../scripts/lib/oauth-local.ts");
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND x" } });
    expect(describeNetworkError("x", err)).toContain("DNS");
  });
});
