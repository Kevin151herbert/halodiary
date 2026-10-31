import { getSession } from "@/lib/supabase/server";

// The assistant's memory: the last conversation, kept per user so it can pick up where you left off.
export async function GET() {
  const { supabase, profile } = await getSession();
  if (!profile) return Response.json({ messages: [] });
  const { data } = await supabase.from("assistant_conversations").select("messages").eq("user_id", profile.id).maybeSingle();
  return Response.json({ messages: data?.messages ?? [] });
}

export async function POST(req: Request) {
  const { supabase, profile } = await getSession();
  if (!profile) return new Response(null, { status: 401 });
  const { messages } = await req.json();
  // Keep the most recent 40 messages.
  const trimmed = Array.isArray(messages) ? messages.slice(-40) : [];
  await supabase
    .from("assistant_conversations")
    .upsert({ user_id: profile.id, messages: trimmed, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return new Response(null, { status: 204 });
}

export async function DELETE() {
  const { supabase, profile } = await getSession();
  if (!profile) return new Response(null, { status: 401 });
  await supabase.from("assistant_conversations").delete().eq("user_id", profile.id);
  return new Response(null, { status: 204 });
}
