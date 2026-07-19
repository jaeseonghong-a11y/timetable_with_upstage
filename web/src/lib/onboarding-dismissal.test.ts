import { describe, expect, it } from "vitest";

import {
  dismissOnboardingForToday,
  getEndOfDayTimestamp,
  isOnboardingDismissedForToday,
} from "./onboarding-dismissal";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("onboarding dismissal persistence", () => {
  it("is not dismissed when nothing was ever stored", () => {
    const storage = fakeStorage();
    expect(isOnboardingDismissedForToday(storage, new Date("2026-07-20T09:00:00"))).toBe(false);
  });

  it("stays dismissed for the rest of the same day after checking the box", () => {
    const storage = fakeStorage();
    const morning = new Date("2026-07-20T09:00:00");
    dismissOnboardingForToday(storage, morning);

    expect(isOnboardingDismissedForToday(storage, new Date("2026-07-20T09:00:01"))).toBe(true);
    expect(isOnboardingDismissedForToday(storage, new Date("2026-07-20T23:59:58"))).toBe(true);
  });

  it("shows again once the day rolls over", () => {
    const storage = fakeStorage();
    dismissOnboardingForToday(storage, new Date("2026-07-20T09:00:00"));

    expect(isOnboardingDismissedForToday(storage, new Date("2026-07-21T00:00:01"))).toBe(false);
  });

  it("ignores a corrupted stored value instead of staying dismissed forever", () => {
    const storage = fakeStorage({ "skku-timetable:onboarding-dismissed-until": "not-a-number" });
    expect(isOnboardingDismissedForToday(storage, new Date("2026-07-20T09:00:00"))).toBe(false);
  });

  it("computes end-of-day as 23:59:59.999 local time", () => {
    const end = getEndOfDayTimestamp(new Date("2026-07-20T09:00:00"));
    const endDate = new Date(end);
    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
    expect(endDate.getSeconds()).toBe(59);
  });
});
