"use client";
import { GlobeHemisphereEastIcon } from "@phosphor-icons/react/dist/csr/GlobeHemisphereEast";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { Popover, PopoverContent, PopoverTrigger } from "@rallypoint/ui";

/** What public and private mean (D-27), behind a small "?" button. */
export function VisibilityInfo() {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="What public and private mean"
        className="inline-flex size-7 items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <QuestionIcon size={16} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="grid max-w-72 gap-2 p-3 text-left text-sm">
        <p className="m-0">
          <strong>Public:</strong> people can find you by name in Search.
        </p>
        <p className="m-0">
          <strong>Private:</strong> you don’t show up in Search. People with
          your profile link, and people in your sessions, still see it.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** "Public" or "Private", with the explanation one tap away. */
export function VisibilityTag({ discoverable }: { discoverable: boolean }) {
  const Icon = discoverable ? GlobeHemisphereEastIcon : LockSimpleIcon;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
      <Icon size={14} aria-hidden="true" />
      {discoverable ? "Public" : "Private"}
      <VisibilityInfo />
    </span>
  );
}
