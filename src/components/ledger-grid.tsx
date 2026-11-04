"use client";

import { AllCommunityModule, type ColDef, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Download, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { btn, field } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

export type LedgerRow = {
  id: string;
  when: string; // ISO
  whenLabel: string;
  what: string;
  service: string;
  party: string;
  amount: number; // signed: money back to the client is negative
  ref: string;
  mode: "Sandbox" | "Simulated" | "Simulated: PayPal unavailable";
  confirmed: string; // "PayPal ✓", "Waiting" or ""
  note: string;
};

// The grid wears HaloDiary's clay palette.
const theme = themeQuartz.withParams({
  backgroundColor: "#fbfcfe",
  foregroundColor: "#1d2238",
  headerBackgroundColor: "#eef1f6",
  headerTextColor: "#5d6480",
  borderColor: "#e3e6ef",
  rowHoverColor: "#fdf1d6",
  selectedRowBackgroundColor: "#fdf1d6",
  accentColor: "#eba721",
  fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
  wrapperBorderRadius: 22,
  headerFontWeight: 700,
  spacing: 7,
});

/** The payments ledger on AG Grid: sort, filter, search and export to CSV. */
export function LedgerGrid({ rows, currency, fileName, partyLabel = "Provider" }: { rows: LedgerRow[]; currency: string; fileName: string; partyLabel?: string }) {
  const grid = useRef<AgGridReact<LedgerRow>>(null);
  const [q, setQ] = useState("");
  // Filter 200 ms after typing stops, not on every key.
  const [filter, setFilter] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilter(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const money = useMemo(() => new Intl.NumberFormat("en-GB", { style: "currency", currency }), [currency]);
  const cols = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "when", headerName: "When", sort: "desc", valueFormatter: (p) => p.data?.whenLabel ?? "", width: 125, filter: "agDateColumnFilter" },
      { field: "what", headerName: "What", filter: true, width: 150 },
      {
        field: "amount",
        headerName: "Amount",
        type: "rightAligned",
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => (p.value == null ? "" : money.format(p.value)),
        cellStyle: (p) => (Number(p.value) < 0 ? { color: "#2e8a74", fontWeight: "700" } : { color: "#1d2238", fontWeight: "700" }),
        width: 110,
      },
      { field: "service", headerName: "Visit", filter: true, width: 130 },
      { field: "party", headerName: partyLabel, filter: true, width: 120 },
      { field: "confirmed", headerName: "Webhook", width: 105, cellStyle: (p) => (p.value === "PayPal ✓" ? { color: "#2e8a74", fontWeight: "700" } : { color: "#5d6480", fontWeight: "400" }) },
      {
        field: "mode",
        headerName: "Mode",
        filter: true,
        width: 130,
        tooltipValueGetter: (p) => (p.value === "Simulated: PayPal unavailable" ? "PayPal could not be reached, so HaloDiary recorded this step as simulated. The reason is in Activity." : undefined),
        cellStyle: (p) => (p.value === "Simulated: PayPal unavailable" ? { color: "#a3304b", fontWeight: "700" } : { color: "inherit", fontWeight: "400" }),
        valueFormatter: (p) => (p.value === "Simulated: PayPal unavailable" ? "Fallback" : p.value),
      },
      { field: "ref", headerName: "PayPal reference", width: 200, cellStyle: { fontFamily: "ui-monospace, monospace", fontSize: "12px" } },
      { field: "note", headerName: "Note", flex: 1, minWidth: 160 },
    ],
    [money, partyLabel],
  );

  const total = rows.reduce((s, r) => s + (["Charged", "Late change fee", "Extra paid in chat"].includes(r.what) ? r.amount : r.what === "Refunded" ? r.amount : 0), 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search the ledger</span>
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by provider, service or PayPal reference" className={`${field} pl-9`} />
        </label>
        <span className="text-sm text-slate">
          Net charged: <span className="font-bold text-ink">{money.format(total)}</span>
        </span>
        <button type="button" className={btn.ghost} onClick={() => grid.current?.api.exportDataAsCsv({ fileName })}>
          <Download size={16} aria-hidden /> CSV
        </button>
      </div>
      <div className="clay overflow-hidden p-1.5" style={{ height: Math.min(560, 120 + rows.length * 42) }}>
        <AgGridReact<LedgerRow>
          ref={grid}
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, resizable: true }}
          quickFilterText={filter}
          pagination={rows.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          overlayNoRowsTemplate="Nothing yet. Payments appear here once visits are confirmed."
          getRowId={(p) => p.data.id}
        />
      </div>
    </div>
  );
}
