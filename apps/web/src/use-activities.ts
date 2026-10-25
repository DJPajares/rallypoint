"use client";
import type { Activity } from "@rallypoint/domain/activities";
import { useApi } from "./use-api";

/** The shared activity catalog (D-23): public, the same for everyone. */
export function useActivities() {
  const result = useApi<{ activities: Activity[] }>("/api/activities", true);
  return { ...result, catalog: result.data?.activities ?? null };
}
