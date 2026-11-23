import { describe, expect, it } from "vitest";
import { msUntil, postTime } from "../scripts/wait.ts";

const H = 3_600_000;

describe("postTime", () => {
  it("uses a platform's override, else post_at", () => {
    expect(postTime("linkedin", "18:00", "linkedin=09:00, instagram=19:30")).toBe("09:00");
    expect(postTime("instagram", "18:00", "linkedin=09:00, Instagram=19:30")).toBe("19:30");
    expect(postTime("facebook", "18:00", "linkedin=09:00")).toBe("18:00");
    expect(postTime("facebook", "", "")).toBe("");
  });
});

describe("msUntil", () => {
  it("waits until the time later today, in the given zone", () => {
    // 10:00 UTC is 12:00 in Cairo (UTC+2 in November).
    expect(msUntil("18:00", "Africa/Cairo", new Date("2026-11-23T10:00:00Z"))).toBe(6 * H);
    expect(msUntil("18:00", "UTC", new Date("2026-11-23T17:30:00Z"))).toBe(0.5 * H);
  });

  it("rolls over to tomorrow when the time has passed", () => {
    expect(msUntil("09:00", "UTC", new Date("2026-11-23T10:00:00Z"))).toBe(23 * H);
  });

  it("refuses bad times and zones", () => {
    expect(() => msUntil("25:00", "UTC", new Date())).toThrow(/HH:MM/);
    expect(() => msUntil("6pm", "UTC", new Date())).toThrow(/HH:MM/);
    expect(() => msUntil("18:00", "Mars/Olympus", new Date())).toThrow(/IANA/);
  });
});
