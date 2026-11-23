import { describe, expect, it } from "vitest";
import { biggest, bumpFor, nextVersion } from "../scripts/release.ts";

describe("bumpFor", () => {
  it("follows Conventional Commits", () => {
    expect(bumpFor("feat: post to Threads (#15)")).toBe("minor");
    expect(bumpFor("feat(x): links off (#16)")).toBe("minor");
    expect(bumpFor("fix: Instagram carousel status (#17)")).toBe("patch");
    expect(bumpFor("perf: faster upload")).toBe("patch");
    expect(bumpFor("refactor: split content.ts")).toBe("patch");
    expect(bumpFor("docs: Telegram guide")).toBe("none");
    expect(bumpFor("chore(deps): bump vitest")).toBe("none");
    expect(bumpFor("ci: pin zizmor")).toBe("none");
  });

  it("treats ! and BREAKING CHANGE as major", () => {
    expect(bumpFor("feat!: drop the v1 inputs")).toBe("major");
    expect(bumpFor("fix(api)!: rename secret")).toBe("major");
    expect(bumpFor("feat: new inputs", "BREAKING CHANGE: platforms is required")).toBe("major");
  });

  it("counts a non-conventional subject as a patch, and skips merge commits", () => {
    expect(bumpFor("Add files via upload")).toBe("patch");
    expect(bumpFor("Merge remote-tracking branch 'origin/x' into x")).toBe("none");
    expect(bumpFor("Merge pull request #3 from me/x")).toBe("none");
  });
});

describe("biggest / nextVersion", () => {
  it("takes the largest bump of the range", () => {
    expect(biggest(["none", "patch", "minor", "patch"])).toBe("minor");
    expect(biggest(["none", "none"])).toBe("none");
  });

  it("computes the next tag", () => {
    expect(nextVersion("v1.6.0", "minor")).toBe("v1.7.0");
    expect(nextVersion("v1.6.3", "patch")).toBe("v1.6.4");
    expect(nextVersion("v1.6.3", "major")).toBe("v2.0.0");
    expect(nextVersion("v1.6.3", "none")).toBeUndefined();
    expect(nextVersion(undefined, "patch")).toBe("v1.0.0");
    expect(() => nextVersion("release-7", "patch")).toThrow();
  });
});
