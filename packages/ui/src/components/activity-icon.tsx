import type { ReactNode } from "react";

// One drawing per catalog icon key (D-23), all on a 24px grid with the same
// round 1.75 stroke in currentColor, so they follow the text colour in either
// theme. An unknown key draws the general one.
const drawings: Record<string, ReactNode> = {
  pickleball: (
    <>
      <rect x="3.5" y="2.5" width="11" height="13" rx="5.5" />
      <path d="M9 15.5V21" />
      <circle cx="18" cy="18" r="3" />
      <path d="M17 17.2h.01M19 18.8h.01" />
    </>
  ),
  badminton: (
    <>
      <circle cx="12" cy="18.5" r="2.5" />
      <path d="M9.9 17.1 6 3.5h12l-3.9 13.6" />
      <path d="M9.5 3.5 11 16.3M14.5 3.5 13 16.3" />
    </>
  ),
  tennis: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.7 5.6a9 9 0 0 1 0 12.8M18.3 5.6a9 9 0 0 0 0 12.8" />
    </>
  ),
  basketball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3v18" />
      <path d="M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8" />
    </>
  ),
  general: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M18.4 5.6l-2.9 2.9M8.5 15.5l-2.9 2.9" />
  ),
};

/** An activity's icon by its catalog key; decorative, so always hidden. */
export function ActivityIcon({
  icon,
  size = 24,
  className,
}: {
  icon: string | null | undefined;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawings[icon ?? ""] ?? drawings.general}
    </svg>
  );
}
