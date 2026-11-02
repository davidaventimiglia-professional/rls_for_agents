// Copilot panel, shared by the AR app and the arena. It renders the agent's event stream (CC-8). Every
// badge comes from the tool's own envelope; the panel decides nothing about what the agent may do.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Conversation } from "./conversation.ts";
import { Markdown } from "./markdown.tsx";
import { errorMessage, type Badge, type Item } from "./transcript.ts";
import type { AgentClient } from "./types.ts";

const BADGE_TEXT: Record<Badge, string> = { ok: "OK", denied: "DENIED", proposal: "PROPOSAL CREATED", error: "ERROR" };
const BADGE_ICON: Record<Badge, string> = { ok: "✓", denied: "✕", proposal: "⧖", error: "!" };

const ERROR_TEXT: Record<string, string> = {
  access_revoked: "Agent access was revoked. Connect the agent again to continue.",
  limit_reached: "You've reached the limit for now. Try again in a little while.",
  paused: "The agent is paused right now. Please try again shortly.",
  unauthorized: "Your session couldn't be verified. Sign in again.",
  not_configured: "The agent isn't configured for this environment yet.",
  unreachable: "The agent can't be reached right now.",
  interrupted: "The agent's reply was cut off. Send the message again.",
};

const argText = (a: Record<string, unknown>) =>
  Object.entries(a).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");

function ToolChip({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  return (
    <div className={`chip${item.pending ? " chip-pending" : ""} ${item.badges.map((b) => `chip-${b}`).join(" ")}`}
         data-tool={item.name} data-badges={item.badges.join(" ")}>
      <span className="chip-name">{item.name}</span>
      {Object.keys(item.args).length > 0 && <span className="chip-args">{argText(item.args)}</span>}
      <span className="chip-badges">
        {item.pending && <span className="badge badge-pending">…</span>}
        {item.badges.map((b) => (
          <span key={b} className={`badge badge-${b}`}><span className="badge-icon" aria-hidden>{BADGE_ICON[b]}</span>{BADGE_TEXT[b]}</span>
        ))}
      </span>
      {item.rows !== undefined && <span className="chip-rows" data-rows={item.rows}>{item.rows} {item.rows === 1 ? "row" : "rows"}</span>}
      {item.reason && <span className="chip-reason">{item.reason}</span>}
    </div>
  );
}

type Props = {
  agent: AgentClient;
  getJwt: () => Promise<string | null>;
  /** Consent needed. `prompt` is the message that asked for it, so an app can send it again on return. */
  onConsent: (url: string, prompt?: string) => void;
  /** A message to send as soon as the panel opens (the arena's first message, held across consent). */
  resume?: string | null;
  /** The app's own wording for CC-8 error codes (falls back to the defaults above). */
  errorText?: Partial<Record<string, string>>;
  placeholder?: string;
  title?: string;
  /** The kill switch is on (CC-10): this message is shown and Send is off. Presentation only; the proxy refuses too. */
  paused?: string | null;
  /** The conversation to show, held by the app above wherever the panel is placed (#40). Without one, the panel keeps
   * its own, which ends when the panel does. */
  conversation?: Conversation;
};

/** The words a panel shows for an error code: the app's own (errorText), else the panel's defaults. */
export const copilotText = (errorText?: Partial<Record<string, string>>) =>
  (code: string, raw = "") => errorMessage(code, raw, ERROR_TEXT, errorText);

export function CopilotPanel({ agent, getJwt, onConsent, resume, errorText, placeholder = "Ask about invoices, payments or customers", title = "Copilot", paused, conversation }: Props) {
  const [own] = useState(() => new Conversation(null));
  const chat = conversation ?? own;
  const { items, busy, lastPrompt } = useSyncExternalStore(chat.subscribe, chat.get);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const resumed = useRef(false);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [items]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy || paused) return;
    setInput("");
    await sendText(text);
  };

  const sendText = (text: string, resume = false) =>
    chat.send(text, { agent, getJwt, textFor: copilotText(errorText) }, { resume });

  // Deferred a tick: under StrictMode the first mount is torn down at once, so only the mount that stays sends.
  useEffect(() => {
    if (!resume || resumed.current) return;
    const t = setTimeout(() => { resumed.current = true; void sendText(resume, true); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  const reset = () => chat.reset();

  return (
    <section className="copilot" aria-label={title}>
      <header className="copilot-head">
        <h2>{title}</h2>
        <button type="button" className="link" onClick={reset}>New conversation</button>
      </header>
      <div className="copilot-log" aria-live="polite">
        {items.length === 0 && <p className="copilot-empty">Ask the agent to work on your receivables. It can only do what you can do, and the database checks every action.</p>}
        {items.map((it, i) => {
          if (it.kind === "user") return <div key={i} className="msg msg-user">{it.text}</div>;
          // Only the agent's replies get the markdown subset (#39); questions and notices stay plain text.
          if (it.kind === "assistant") return <div key={i} className="msg msg-assistant md"><Markdown text={it.text} /></div>;
          if (it.kind === "tool") return <ToolChip key={i} item={it} />;
          return (
            <div key={i} className={`notice notice-${it.tone}`} data-code={it.code}>
              {it.text}
              {it.url && <button type="button" className="primary" onClick={() => onConsent(it.url!, lastPrompt)}>Connect agent</button>}
              {it.retry && i === items.length - 1 && lastPrompt && (
                <button type="button" className="primary" disabled={busy || !!paused} onClick={() => sendText(lastPrompt)}>Send again</button>
              )}
            </div>
          );
        })}
        {busy && <div className="msg msg-thinking">Working…</div>}
        <div ref={end} />
      </div>
      {paused && <p className="notice copilot-paused" role="status" data-testid="paused">{paused}</p>}
      <form className="copilot-input" onSubmit={send}>
        <textarea value={input} placeholder={placeholder} rows={2} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="primary" disabled={busy || !input.trim() || !!paused}>Send</button>
      </form>
    </section>
  );
}
