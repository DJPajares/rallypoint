"use client";
import type { ReactNode } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
export function Pending({
  children = "Getting things ready…",
}: {
  children?: ReactNode;
}) {
  return (
    <p role="status" className="status">
      <CircleNotchIcon className="spin" size={20} />
      {children}
    </p>
  );
}
export function Notice({
  children,
  retry,
}: {
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="notice" role="alert">
      <WarningCircleIcon size={22} />
      <div>
        {children}
        {retry ? (
          <button className="text-button" onClick={retry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
