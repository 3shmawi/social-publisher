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
