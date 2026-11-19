// The places one platform posts to. LinkedIn can post twice: as you and as
// your company page; each gets its own "already posted" tag.
import { targets } from "../platforms/linkedin.ts";

export function channels(platform: string): string[] {
  if (platform === "linkedin") return targets().map((t) => `linkedin-${t.kind}`);
  return [platform];
}
