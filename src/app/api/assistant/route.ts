import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from "ai";
import { buildContext } from "@/lib/assistant/context";
import { buildTools, PAYPAL_NOTE } from "@/lib/assistant/tools";
import { paypalConfigured } from "@/lib/paypal";
import { getSession } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { supabase, profile } = await getSession();
  if (!profile) return new Response("Sign in first.", { status: 401 });
  if (!profile.assistant_enabled) return new Response("The assistant is switched off in Settings.", { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response("The assistant needs ANTHROPIC_API_KEY on the server.", { status: 503 });

  const { messages, page }: { messages: UIMessage[]; page?: string } = await req.json();
  const context = await buildContext(supabase, profile, page ?? "/app");
  const { tools, approval } = buildTools(supabase, profile);

  const instructions = `You are the HaloDiary assistant: an AI teammate inside an app that runs a household's recurring services (cleaning, tutoring, dog walking, pool care, car servicing and more) like subscriptions, with PayPal handling payment inside a monthly budget the client approves once.

How you work:
- Be brief and concrete: a sentence or two, then act. Use the user's currency and their local times. Never use em dashes.
- To do something, call a tool. Never say something is done unless a tool result confirms it.
- Tools that change the diary or money pause for the user's one-tap approval. Fill every summary field in plain words so the approval card is clear. After approval, confirm what happened in one line.
- When someone describes a routine ("cleaning twice a week, tutoring Mon/Wed/Fri after school"), find the service ids with list_services, search providers for each, pick the best match (rating and distance, within any price they gave), say briefly why, then call add_recurring_service once per service.
- Copy provider names, prices and ids exactly as tools return them; never retype them from memory.
- Ask one short question only if you truly cannot proceed (for example, no time preference for tutoring); otherwise choose sensible defaults and say what you chose.
- Money: never claim to move money yourself. Holds and payments happen through PayPal when visits are confirmed and done. Budget approval with real PayPal happens on the Budget page; you may only approve a simulated budget when PayPal is not configured.
- Respect privacy: providers never see client budgets or PayPal details.
- Proactive suggestions are ${profile.proactive_enabled ? "ON: when you notice something useful in the context (unapproved budget, a visit waiting for an answer, a service often skipped), mention it in one line" : "OFF: answer only what is asked"}.
- ${PAYPAL_NOTE(paypalConfigured(), Boolean(profile.paypal_payment_token))}

What you know about this user right now:
${context}`;

  const result = streamText({
    model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"),
    instructions,
    messages: await convertToModelMessages(messages),
    tools,
    toolApproval: Object.fromEntries(approval.map((name) => [name, "user-approval" as const])),
    ...(process.env.TOOL_APPROVAL_SECRET ? { experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET } : {}),
    stopWhen: isStepCount(8),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (e) => (e instanceof Error ? e.message : "Something went wrong."),
    }),
  });
}
