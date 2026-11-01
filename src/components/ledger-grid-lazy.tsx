"use client";

// AG Grid is the heaviest library on these pages; load it after the page shows, with a placeholder.
import dynamic from "next/dynamic";
import { Bone } from "./skeleton";

export const LedgerGrid = dynamic(() => import("./ledger-grid").then((m) => m.LedgerGrid), {
  ssr: false,
  loading: () => (
    <div className="space-y-2" aria-label="Loading the ledger">
      <Bone className="h-12 rounded-full" />
      <Bone className="h-64" />
    </div>
  ),
});
