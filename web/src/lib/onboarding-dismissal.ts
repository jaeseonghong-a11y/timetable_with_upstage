const DISMISS_UNTIL_KEY = "skku-timetable:onboarding-dismissed-until";

/** Midnight at the end of the given moment's calendar day, as an epoch ms timestamp. */
export function getEndOfDayTimestamp(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
}

/** True once "오늘 하루 안 보기" was checked and today hasn't rolled over yet. */
export function isOnboardingDismissedForToday(storage: Pick<Storage, "getItem">, now: Date): boolean {
  const raw = storage.getItem(DISMISS_UNTIL_KEY);
  if (!raw) {
    return false;
  }
  const until = Number(raw);
  return Number.isFinite(until) && now.getTime() < until;
}

export function dismissOnboardingForToday(storage: Pick<Storage, "setItem">, now: Date): void {
  storage.setItem(DISMISS_UNTIL_KEY, String(getEndOfDayTimestamp(now)));
}
