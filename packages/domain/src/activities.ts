/**
 * The sports offered as one-tap choices. A session still stores its activity
 * as plain text, so any other activity stays valid and older sessions keep
 * whatever they were saved with.
 */
export const presetActivities = [
  "Pickleball",
  "Badminton",
  "Tennis",
  "Basketball",
] as const;
export type PresetActivity = (typeof presetActivities)[number];
/** The preset an activity's text names, ignoring case and outer spaces. */
export function presetFor(activity: string): PresetActivity | null {
  const text = activity.trim().toLowerCase();
  return presetActivities.find((a) => a.toLowerCase() === text) ?? null;
}
