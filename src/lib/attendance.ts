// A provider's attendance: every booked visit they rendered, moved to another time, or cancelled.
// It combines their track record (seeded history for demo providers) with visits on this diary.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Outcome = "rendered" | "alternative" | "cancelled";
export type AttendanceItem = { at: string; outcome: Outcome; service: string; note: string; yours: boolean };
export type Attendance = {
  items: AttendanceItem[];
  total: number;
  rendered: number;
  alternative: number;
  cancelled: number;
  rate: number; // share rendered as booked
};

export async function attendanceFor(supabase: SupabaseClient, providerId: string, nowIso: string): Promise<Attendance> {
  const [{ data: history }, { data: visits }] = await Promise.all([
    supabase
      .from("service_records")
      .select("occurred_at, outcome, note, services(name)")
      .eq("provider_id", providerId)
      .order("occurred_at", { ascending: false })
      .limit(80),
    // Row level security limits this to the viewer's own visits with this provider.
    supabase
      .from("visits")
      .select("scheduled_at, status, provider_response, cancel_reason, moved_by, services(name)")
      .eq("provider_id", providerId)
      .lte("scheduled_at", new Date(new Date(nowIso).getTime() + 60 * 86_400_000).toISOString())
      .order("scheduled_at", { ascending: false })
      .limit(80),
  ]);

  const items: AttendanceItem[] = (history ?? []).map((h) => ({
    at: h.occurred_at,
    outcome: h.outcome as Outcome,
    service: (h.services as unknown as { name: string } | null)?.name ?? "",
    note: h.note,
    yours: false,
  }));

  for (const v of visits ?? []) {
    const service = (v.services as unknown as { name: string } | null)?.name ?? "";
    if (v.provider_response === "cancel") {
      items.push({ at: v.scheduled_at, outcome: "cancelled", service, note: v.cancel_reason || "No reason given", yours: true });
    } else if (v.provider_response === "reschedule") {
      items.push({ at: v.scheduled_at, outcome: "alternative", service, note: "Offered another time instead", yours: true });
    } else if (v.status === "completed" && v.moved_by !== "provider") {
      // A visit the provider moved is already counted once, as the alternative they offered.
      items.push({ at: v.scheduled_at, outcome: "rendered", service, note: "", yours: true });
    }
  }
  items.sort((a, b) => +new Date(b.at) - +new Date(a.at));

  const count = (o: Outcome) => items.filter((i) => i.outcome === o).length;
  const total = items.length;
  const rendered = count("rendered");
  return { items, total, rendered, alternative: count("alternative"), cancelled: count("cancelled"), rate: total ? rendered / total : 1 };
}

/** Attendance rate for many providers at once, for result cards. */
export async function attendanceRates(supabase: SupabaseClient, providerIds: string[]) {
  const rates = new Map<string, number>();
  if (!providerIds.length) return rates;
  const { data } = await supabase.from("service_records").select("provider_id, outcome").in("provider_id", providerIds).limit(5000);
  const tally = new Map<string, { r: number; t: number }>();
  for (const row of data ?? []) {
    const t = tally.get(row.provider_id) ?? { r: 0, t: 0 };
    t.t += 1;
    if (row.outcome === "rendered") t.r += 1;
    tally.set(row.provider_id, t);
  }
  for (const [id, t] of tally) rates.set(id, t.r / t.t);
  return rates;
}
