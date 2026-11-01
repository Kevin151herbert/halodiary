// HaloDiary's MCP server (Streamable HTTP, stateless JSON responses).
// Other AI assistants (Claude Desktop, ChatGPT, custom agents) connect with a personal access token
// from Settings and get the same tools as the in-app assistant: same agreements, same PayPal flow,
// same row level security, plus the user's AI spending limit and a logged reason for every action.

import { z } from "zod";
import { buildContext } from "@/lib/assistant/context";
import { buildTools } from "@/lib/assistant/tools";
import { agentFromToken } from "@/lib/agent-tokens";
import { limitFor } from "@/lib/agent-guard";
import { log } from "@/lib/engine";

export const maxDuration = 60;

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type AnyTool = { description?: string; inputSchema: z.ZodObject; execute: (i: unknown, o: unknown) => Promise<unknown> };

const PROTOCOL = "2025-06-18";
const reasonField = z.string().min(3).describe("Why you are doing this, in one sentence the user will read in their HaloDiary activity log.");

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function unauthorized(reason: string) {
  return new Response(JSON.stringify(fail(null, -32001, reason)), {
    status: 401,
    headers: { "content-type": "application/json", "WWW-Authenticate": 'Bearer realm="HaloDiary", error="invalid_token"' },
  });
}

export async function GET() {
  return new Response("HaloDiary MCP server. POST JSON-RPC here with Authorization: Bearer <token from Settings>.", { status: 405, headers: { Allow: "POST" } });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized("Add Authorization: Bearer <token>. Create a token in HaloDiary under Settings, AI agents.");
  let agent: Awaited<ReturnType<typeof agentFromToken>>;
  try {
    agent = await agentFromToken(token);
  } catch (e) {
    return Response.json(fail(null, -32603, e instanceof Error ? e.message : "Server error"), { status: 503 });
  }
  if (!agent) return unauthorized("This token is not valid or was revoked.");

  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }

  const { supabase, profile, label } = agent;
  const origin = { via: "mcp" as const, agent: label };
  const { tools: raw, approval } = buildTools(supabase, profile, origin);
  const tools = raw as unknown as Record<string, AnyTool>;
  const acting = new Set(approval);
  const schemaFor = (name: string) => (acting.has(name) ? tools[name].inputSchema.extend({ reason: reasonField }) : tools[name].inputSchema);

  const handle = async (m: Rpc) => {
    switch (m.method) {
      case "initialize":
        return ok(m.id, {
          protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "halodiary", title: "HaloDiary", version: "1.0.0" },
          instructions: `You are acting for ${profile.full_name} (${profile.role}) in HaloDiary, which runs recurring household services with PayPal payments inside a monthly budget. Call get_context first. Every action needs a 'reason' the user will read. Each action is priced against the user's AI spending limit of ${
            limitFor(profile, origin) ?? "no limit"
          } ${profile.currency} per payment; anything over it is refused, so ask the user to do it in the app. Never use em dashes.`,
        });
      case "ping":
        return ok(m.id, {});
      case "tools/list":
        return ok(m.id, {
          tools: [
            {
              name: "get_context",
              title: "What HaloDiary knows right now",
              description: "A snapshot of the user's diary, budget, agreements, open checks and spending limit. Call this first.",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
            },
            ...Object.keys(tools).map((name) => ({
              name,
              description: `${tools[name].description ?? ""}${acting.has(name) ? " Changes the user's diary or money: give a reason; checked against their AI spending limit." : ""}`,
              inputSchema: z.toJSONSchema(schemaFor(name), { target: "draft-7" }),
              annotations: acting.has(name) ? { readOnlyHint: false, destructiveHint: true, openWorldHint: true } : { readOnlyHint: true },
            })),
          ],
        });
      case "tools/call": {
        const name = String(m.params?.name ?? "");
        const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
        if (name === "get_context") {
          const text = await buildContext(supabase, profile, "/app");
          const limit = limitFor(profile, origin);
          return ok(m.id, { content: [{ type: "text", text: `${text}\n\nAI spending limit: ${limit == null ? "none" : `${profile.currency} ${limit}`} per payment.` }] });
        }
        if (!tools[name]) return fail(m.id, -32602, `Unknown tool ${name}`);
        const parsed = schemaFor(name).safeParse(args);
        if (!parsed.success) return ok(m.id, { isError: true, content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }] });
        const input = parsed.data as Record<string, unknown>;
        if (acting.has(name) && profile.role === "client" && !profile.assistant_enabled)
          return ok(m.id, { isError: true, content: [{ type: "text", text: "The user has switched AI actions off in HaloDiary Settings." }] });
        let result: unknown;
        try {
          result = await tools[name].execute(input, { toolCallId: crypto.randomUUID(), messages: [] });
        } catch (e) {
          result = { error: e instanceof Error ? e.message : "Something went wrong" };
        }
        const isError = Boolean(result && typeof result === "object" && "error" in result && (result as { error: unknown }).error);
        if (acting.has(name) && !isError)
          await log(supabase, profile.id, "assistant", `${label} (external AI) used ${name.replace(/_/g, " ")}: ${input.reason}`, { via: "mcp", agent: label, tool: name, input });
        return ok(m.id, { isError, content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result && typeof result === "object" ? result : { value: result } });
      }
      default:
        if (m.id === undefined) return null; // notifications need no answer
        return fail(m.id, -32601, `Method not found: ${m.method}`);
    }
  };

  const batch = Array.isArray(body);
  const list: Rpc[] = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(list.map(handle))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}
