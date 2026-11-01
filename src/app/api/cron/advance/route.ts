import { advance } from "@/lib/engine";
import { adminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * Runs the scheduler for every client, so day-before checks, holds and payouts happen on time even when
 * nobody opens the app. Triggered every 10 minutes by a Render cron job (render.yaml).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const supabase = adminClient();
  if (!supabase) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const started = Date.now();
  const { data: active } = await supabase.from("plans").select("client_id").eq("status", "active");
  const ids = [...new Set((active ?? []).map((p) => p.client_id))];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("*").in("id", ids).eq("role", "client") : { data: [] };
  let ok = 0;
  const failed: string[] = [];
  for (const p of (profiles ?? []) as Profile[]) {
    if (Date.now() - started > 50_000) break; // stay inside the function limit; the next run continues
    try {
      await advance(supabase, p);
      ok += 1;
    } catch (e) {
      failed.push(`${p.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const result = { clients: ids.length, advanced: ok, failed, ms: Date.now() - started, via: req.headers.get("user-agent")?.slice(0, 60) ?? "" };
  await supabase.from("job_runs").insert({ job: "scheduler", result });
  return Response.json(result);
}

export const GET = POST;
