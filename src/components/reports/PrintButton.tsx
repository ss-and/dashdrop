"use client";

import { Button } from "@/components/ui/Button";
import { NavIcon } from "@/components/app/icons";

/** Triggers the browser print dialog (Save as PDF). Hidden when printing. */
export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <NavIcon name="download" className="h-4 w-4" />
      印刷 / PDFで保存
    </Button>
  );
}
