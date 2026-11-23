// How did the posts do? Run daily by examples/social-insights.yml (→
// .github/workflows/insights.yml): finds what was posted [DAYS] days ago
// (default 7; or the update in KEY) from the social/posted/* tags, reads
// each post's views, likes, comments and shares, and writes one table to
// the job summary.
import { pathToFileURL } from "node:url";
import { env, run, summary } from "./lib/env.ts";
import { type PostedRecord, postedRecords } from "./lib/github.ts";
import { type Metrics, metricsFor } from "./lib/metrics.ts";

const DAY = 86_400_000;

/** Records posted between [days]+1 and [days] days before [now] (a daily run sees each once), or for [key]. */
export function pick(records: PostedRecord[], now: Date, days: number, key = ""): PostedRecord[] {
  if (key) return records.filter((r) => r.key === key);
  const until = now.getTime() - days * DAY;
  const from = until - DAY;
  return records.filter((r) => {
    const t = Date.parse(r.postedAt);
    return t >= from && t < until;
  });
}

const fmt = (n?: number) => (n === undefined ? "–" : n.toLocaleString("en-US"));

export function table(rows: { record: PostedRecord; metrics: Metrics }[]): string {
  const lines = ["| Update | Where | Views | Likes | Comments | Shares | Note |", "|---|---|---|---|---|---|---|"];
  for (const { record, metrics } of rows) {
    const link = record.links[0] ? `[${record.channel}](${record.links[0].url})` : record.channel;
    lines.push(
      `| ${record.key} | ${link} | ${fmt(metrics.views)} | ${fmt(metrics.likes)} | ${fmt(metrics.comments)} | ${fmt(metrics.shares)} | ${(metrics.note ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const days = Number(env("DAYS", "7"));
  const key = env("KEY");
  const picked = pick(await postedRecords(), new Date(), days, key);
  if (picked.length === 0) {
    summary(`## 📈 Social insights\n\nNothing was posted ${key ? `for \`${key}\`` : `${days} days ago`}.`);
    return;
  }
  const rows = [];
  for (const record of picked) {
    rows.push({ record, metrics: await metricsFor(record.platform, record.ids[0] ?? "") });
  }
  summary(`## 📈 Social insights — ${key ? `\`${key}\`` : `posted ${days} days ago`}\n\n${table(rows)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);
