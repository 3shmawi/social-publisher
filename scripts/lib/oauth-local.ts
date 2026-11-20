// For the local token helpers: ask for a value without echoing secrets, and
// wait for one OAuth redirect on a localhost port.
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";

export async function ask(question: string, fromEnv?: string): Promise<string> {
  if (fromEnv && process.env[fromEnv]) return process.env[fromEnv]!.trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

/** Start a server on 127.0.0.1:<port>, resolve with the query of the first request to <path>. */
export function waitForRedirect(port: number, path: string): Promise<{ query: URLSearchParams; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      if (url.pathname !== path) {
        res.writeHead(404).end();
        return;
      }
      // Read the port before close(): afterwards address() is null.
      const { port: boundPort } = server.address() as { port: number };
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Done. You can close this tab and go back to the terminal.</h2>");
      server.close();
      resolve({ query: url.searchParams, port: boundPort });
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

export function listening(port: number): Promise<number> {
  // Find a free port when 0 is passed (Google allows any loopback port).
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      const p = (probe.address() as { port: number }).port;
      probe.close(() => resolve(p));
    });
  });
}
