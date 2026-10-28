// Public or Private, for groups (P-35): the same words wherever it's chosen.
export const visibilityOptions = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];
export const visibilityHelp = (visibility: string) =>
  visibility === "private"
    ? "Only people with your invite link can ask to join."
    : "Anyone can find it and ask to join.";
