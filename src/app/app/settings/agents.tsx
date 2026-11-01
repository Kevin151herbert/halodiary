"use client";

import { Check, Copy, Plug, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createAgentTokenAction, revokeAgentTokenAction } from "../actions";

type TokenRow = { id: string; label: string; token_hint: string; used: string };

export function AgentConnections({ tokens, mcpUrl }: { tokens: TokenRow[]; mcpUrl: string }) {
  const [label, setLabel] = useState("Claude Desktop");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const config = fresh
    ? JSON.stringify(
        { mcpServers: { halodiary: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", `Authorization: Bearer ${fresh}`] } } },
        null,
        2,
      )
    : "";

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked: the text stays selectable */
    }
  };

  return (
    <div className="clay mt-4 space-y-5 p-5">
      <p className="text-sm text-slate">
        Let another AI assistant (Claude Desktop, ChatGPT or your own agent) run your diary through HaloDiary&apos;s MCP server. It gets the same tools,
        agreements and PayPal checks as the assistant here, every action is logged with its reason, and nothing over your limit goes through.
      </p>

      <ul className="divide-y divide-mist/70 overflow-hidden rounded-2xl bg-white/60" aria-label="Connected assistants">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <Plug size={16} className="shrink-0 text-slate" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{t.label}</span>
              <span className="block text-xs text-slate">
                {t.token_hint} · {t.used}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => start(async () => void (await revokeAgentTokenAction(t.id)))}
              className="clay-btn-ghost inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
            >
              <Trash2 size={14} aria-hidden /> Disconnect
            </button>
          </li>
        ))}
        {!tokens.length && <li className="px-4 py-3 text-sm text-slate">No outside assistants connected.</li>}
      </ul>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm font-bold">
          Name it
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="clay-inset mt-1.5 w-full px-4 py-2.5 font-normal" maxLength={60} />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setErr(null);
              const r = await createAgentTokenAction(label);
              if ("error" in r && r.error) setErr(r.error);
              else if ("token" in r && r.token) setFresh(r.token);
            })
          }
          className="clay-btn-ink rounded-full px-5 py-2.5 text-sm font-bold"
        >
          {busy ? "Creating…" : "Connect an assistant"}
        </button>
      </div>
      {err && <p className="text-sm text-rose">{err}</p>}

      {fresh && (
        <div className="clay-inset space-y-3 p-4 text-sm" role="status">
          <p className="font-bold">Copy this now. HaloDiary only shows it once.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-white px-3 py-2 font-mono text-xs">{fresh}</code>
            <button type="button" onClick={() => copy("token", fresh)} className="clay-btn-ghost rounded-full p-2" aria-label="Copy token">
              {copied === "token" ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <p className="text-slate">
            Server URL: <code className="font-mono text-xs text-ink">{mcpUrl}</code>. For Claude Desktop, add this to claude_desktop_config.json and restart it:
          </p>
          <div className="relative">
            <pre className="overflow-x-auto rounded-xl bg-ink p-3 font-mono text-[11px] leading-relaxed text-white">{config}</pre>
            <button type="button" onClick={() => copy("config", config)} className="absolute right-2 top-2 rounded-full bg-white/15 p-1.5 text-white" aria-label="Copy config">
              {copied === "config" ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
