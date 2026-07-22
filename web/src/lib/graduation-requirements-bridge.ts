"use client";

import { useSyncExternalStore } from "react";

import type { Requirement, RequirementScope, RequirementStatus } from "./academic-profile";

/**
 * The remix page is independent from the wizard route. Keep only the non-identifying fields it
 * needs in JavaScript module memory; a browser refresh reloads this module and clears the data.
 */
export interface GraduationRequirementSummary {
  scope: RequirementScope;
  status: RequirementStatus;
  label: string;
}

let snapshot: readonly GraduationRequirementSummary[] | null = null;
const listeners = new Set<() => void>();

export function setConfirmedGraduationRequirementSummaries(
  requirements: readonly Requirement[] | undefined,
): void {
  const next = requirements
    ? requirements.map(({ scope, status, label }) => ({ scope, status, label: label.trim() }))
    : null;
  if (isSameSummary(snapshot, next)) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getConfirmedGraduationRequirementSummaries(): readonly GraduationRequirementSummary[] | null {
  return snapshot;
}

export function useConfirmedGraduationRequirementSummaries(): readonly GraduationRequirementSummary[] | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getConfirmedGraduationRequirementSummaries,
    () => null,
  );
}

function isSameSummary(
  first: readonly GraduationRequirementSummary[] | null,
  second: readonly GraduationRequirementSummary[] | null,
): boolean {
  if (first === second) return true;
  if (!first || !second || first.length !== second.length) return false;
  return first.every(
    (item, index) =>
      item.scope === second[index]?.scope &&
      item.status === second[index]?.status &&
      item.label === second[index]?.label,
  );
}
