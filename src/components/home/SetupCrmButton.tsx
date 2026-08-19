"use client";

import { SetupMasterButton } from "./SetupMasterButton";

/**
 * 「顧客データベースをはじめる」 — thin wrapper over `SetupMasterButton`, kept
 * because the getting-started block and the home page both refer to it by name.
 */
export function SetupCrmButton(props: {
  label?: string;
  withSampleData?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  return <SetupMasterButton kind="crm" {...props} />;
}
