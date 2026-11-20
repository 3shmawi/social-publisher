import { describe, expect, it } from "vitest";
import { cleanSubject, notesItems, splitItems, version } from "../scripts/lib/template.ts";
import type { Context } from "../scripts/lib/content.ts";

describe("template writer", () => {
  it("splits bullet text into items", () => {
    expect(splitItems("• Book a table\n- Faster menu\n1. Dark mode\n\n# heading")).toEqual([
      "Book a table",
      "Faster menu",
      "Dark mode",
    ]);
  });

  it("cleans commit subjects and drops internal ones", () => {
    expect(cleanSubject("feat(menu): add search (#12)")).toBe("Add search");
    expect(cleanSubject("fix!: crash on login")).toBe("Crash on login");
    expect(cleanSubject("chore(deps): bump x")).toBe("");
    expect(cleanSubject("Improve the menu")).toBe("Improve the menu");
  });

  it("reads bullets from release notes, without headings or the footer", () => {
    const notes = "## Features\n- Dark mode\n- chore: bump\n## Fixes\n- fix: crash\n\n---\n- Announce update\n";
    expect(notesItems(notes)).toEqual(["Dark mode", "Crash"]);
  });

  it("shows a version only for version tags", () => {
    expect(version({ tag: "v1.2.0" } as Context)).toBe("1.2.0");
    expect(version({ tag: "" } as Context)).toBe("");
  });
});
