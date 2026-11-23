// Before a platform posts (after approval): wait until the posting time.
//   npx tsx scripts/wait.ts <platform>
// POST_AT (HH:MM), POST_TIMEZONE (IANA, e.g. Africa/Cairo) and
// POST_AT_OVERRIDES ("linkedin=09:00,instagram=19:30") choose the time;
// the next occurrence of it is used. GitHub stops a job after 6 hours, so a
// time more than MAX_WAIT_HOURS away posts now, with a warning.
import { pathToFileURL } from "node:url";
import { env, envBool, notice, run, warning } from "./lib/env.ts";

/** The time for [platform]: its override, else POST_AT; "" = post at once. */
export function postTime(platform: string, postAt: string, overrides: string): string {
  for (const pair of overrides.split(",")) {
    const [name, time] = pair.split("=").map((s) => s.trim());
    if (name?.toLowerCase() === platform && time) return time;
  }
  return postAt.trim();
}

/** Milliseconds from [now] until the next [hhmm] in [timeZone]. */
export function msUntil(hhmm: string, timeZone: string, now: Date): number {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) throw new Error(`post_at must be HH:MM (24-hour), got "${hhmm}"`);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    throw new Error(`post_timezone "${timeZone}" isn't an IANA time zone (e.g. Africa/Cairo, Europe/London)`);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const nowSec = get("hour") * 3600 + get("minute") * 60 + get("second");
  const targetSec = Number(match[1]) * 3600 + Number(match[2]) * 60;
  const diff = (targetSec - nowSec + 86_400) % 86_400;
  return diff * 1000;
}

async function main(): Promise<void> {
  const platform = (process.argv[2] ?? "").toLowerCase();
  const time = postTime(platform, env("POST_AT"), env("POST_AT_OVERRIDES"));
  if (!time) return;
  if (envBool("DRY_RUN", true)) {
    notice(`${platform}: would wait until ${time} ${env("POST_TIMEZONE", "UTC")} (dry run: not waiting).`);
    return;
  }
  const zone = env("POST_TIMEZONE", "UTC");
  const wait = msUntil(time, zone, new Date());
  const maxHours = Math.min(Number(env("MAX_WAIT_HOURS", "5")), 5.5);
  if (wait > maxHours * 3_600_000) {
    warning(
      `${platform}: ${time} ${zone} is ${(wait / 3_600_000).toFixed(1)} h away, more than a job can wait (${maxHours} h): posting now. Approve closer to the posting time next time.`,
    );
    return;
  }
  const minutes = Math.round(wait / 60_000);
  console.log(`${platform}: waiting ${minutes} min, until ${time} ${zone}.`);
  // Log every 30 minutes so the run doesn't look stuck.
  let left = wait;
  while (left > 0) {
    const step = Math.min(left, 30 * 60_000);
    await new Promise((r) => setTimeout(r, step));
    left -= step;
    if (left > 0) console.log(`${platform}: ${Math.round(left / 60_000)} min to go.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);
