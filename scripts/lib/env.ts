// Small helpers for running inside GitHub Actions: inputs, outputs, the job
// summary, masking and the folder the jobs share through artifacts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Folder that holds context.json, posts.json, media/ and results/. */
export const OUT_DIR = process.env.SOCIAL_OUT ?? "out";

export function outPath(...parts: string[]): string {
  return path.join(OUT_DIR, ...parts);
}

export function env(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value.trim();
}

export function envBool(name: string, fallback = false): boolean {
  const value = env(name);
  if (value === "") return fallback;
  return ["true", "1", "yes"].includes(value.toLowerCase());
}

export function envList(name: string, fallback = ""): string[] {
  return env(name, fallback)
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Hide a value in every later log line. GitHub already hides stored secrets,
 * but not values derived from them (a fresh access token, a page token).
 * Outside Actions this prints nothing: "::add-mask::<value>" would show it.
 */
export function mask(value: string | undefined | null): void {
  if (!value || process.env.GITHUB_ACTIONS !== "true") return;
  for (const line of value.split("\n")) {
    if (line.trim()) process.stdout.write(`::add-mask::${line}\n`);
  }
}

export function setOutput(name: string, value: string | boolean | number): void {
  const file = process.env.GITHUB_OUTPUT;
  const text = String(value);
  if (!file) {
    console.log(`[output] ${name}=${text}`);
    return;
  }
  if (text.includes("\n")) {
    const marker = `EOF_${Math.random().toString(36).slice(2)}`;
    appendFileSync(file, `${name}<<${marker}\n${text}\n${marker}\n`);
  } else {
    appendFileSync(file, `${name}=${text}\n`);
  }
}

export function summary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
  else console.log(markdown);
}

export function notice(message: string): void {
  console.log(process.env.GITHUB_ACTIONS === "true" ? `::notice::${oneLine(message)}` : `notice: ${message}`);
}

export function warning(message: string): void {
  console.log(process.env.GITHUB_ACTIONS === "true" ? `::warning::${oneLine(message)}` : `warning: ${message}`);
}

export function error(message: string): void {
  console.log(process.env.GITHUB_ACTIONS === "true" ? `::error::${oneLine(message)}` : `error: ${message}`);
}

function oneLine(message: string): string {
  return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function readJsonIfExists<T>(file: string): T | undefined {
  return existsSync(file) ? readJson<T>(file) : undefined;
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Run main(), print a clean message (no stack with request details) on failure. */
export function run(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
