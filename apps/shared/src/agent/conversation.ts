// The copilot's conversation, held outside the panel (#40). The panel only shows it, so the panel can move (projector
// mode puts it elsewhere) or go away (the drawer is hidden) without losing the chat, the conversation id the agent
// keeps its context under, or a reply that's still streaming. Saved per user in sessionStorage, so a reload or the
// consent round trip keeps it too; New conversation (reset) and sign-out (clear) end it.
import { reduce, type PanelEvent, type Transcript } from "./transcript.ts";
import type { AgentClient } from "./types.ts";

export type ConversationState = { items: Transcript; session: string; busy: boolean; lastPrompt?: string };
/** What a turn needs from the app: the agent, the signed-in user's JWT, and the app's wording for error codes. */
export type SendDeps = { agent: AgentClient; getJwt: () => Promise<string | null>; textFor: (code: string, raw: string) => string };

const PREFIX = "copilot:";
const fresh = (): ConversationState => ({ items: [], session: crypto.randomUUID(), busy: false });

function defaultStorage(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

export class Conversation {
  private state: ConversationState;
  private readonly listeners = new Set<() => void>();
  private abort: AbortController | null = null;

  /**
   * @param key who the conversation belongs to (e.g. "ar:<user id>"), or null to keep it in memory only.
   * @param interrupted the app's words for a reply cut off by a reload (shown when a saved, unfinished turn is restored).
   */
  constructor(private readonly key: string | null, private readonly storage: Storage | null = defaultStorage(),
              interrupted = "The agent's reply was cut off. Send the message again.") {
    this.state = this.load(interrupted);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get = (): ConversationState => this.state;

  /**
   * One turn. Nothing stops it but reset or clear: the panel unmounting doesn't. With `resume` (the message held
   * across the consent page), a turn that ended asking for consent for this same message continues: its consent
   * notice goes, and the question isn't shown twice.
   */
  async send(text: string, deps: SendDeps, opts: { resume?: boolean } = {}): Promise<void> {
    if (this.state.busy) return;
    const [prev, last] = this.state.items.slice(-2);
    const continues = opts.resume && prev?.kind === "user" && prev.text === text
      && last?.kind === "notice" && last.tone === "consent";
    const items = continues ? this.state.items.slice(0, -1) : reduce(this.state.items, { type: "user", text });
    this.set({ ...this.state, lastPrompt: text, items });
    const jwt = await deps.getJwt();
    if (!jwt) { this.apply({ type: "error", code: "unauthorized", message: deps.textFor("unauthorized", "") }); return; }
    const ac = new AbortController();
    this.abort = ac;
    this.set({ ...this.state, busy: true });
    try {
      for await (const ev of deps.agent.send(jwt, this.state.session, text, ac.signal)) {
        if (ac.signal.aborted) break;
        if (ev.type === "error") console.warn(`agent error ${ev.code}: ${ev.message}`);  // the raw detail, for developers
        this.apply(ev.type === "error" ? { ...ev, message: deps.textFor(ev.code, ev.message) } : ev);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError" && !ac.signal.aborted) {
        console.warn(`agent request failed: ${(err as Error).message}`);
        this.apply({ type: "error", code: "internal", message: deps.textFor("internal", (err as Error).message) });
      }
    }
    if (this.abort === ac) { this.abort = null; this.set({ ...this.state, busy: false }); }
  }

  /** New conversation: stop any reply, empty the chat, and start a new conversation id. */
  reset(): void {
    this.abort?.abort();
    this.abort = null;
    this.set(fresh());
  }

  /** Sign-out: as reset, and forget the saved conversation. */
  clear(): void {
    this.abort?.abort();
    this.abort = null;
    this.state = fresh();
    if (this.key && this.storage) try { this.storage.removeItem(PREFIX + this.key); } catch { /* storage unavailable */ }
    this.listeners.forEach((l) => l());
  }

  private apply(e: PanelEvent) { this.set({ ...this.state, items: reduce(this.state.items, e) }); }

  private set(next: ConversationState) {
    this.state = next;
    if (this.key && this.storage) {
      try { this.storage.setItem(PREFIX + this.key, JSON.stringify(next)); } catch { /* full or unavailable: keep it in memory */ }
    }
    this.listeners.forEach((l) => l());
  }

  private load(interrupted: string): ConversationState {
    if (!this.key || !this.storage) return fresh();
    try {
      const raw = this.storage.getItem(PREFIX + this.key);
      if (!raw) return fresh();
      const s = JSON.parse(raw) as Partial<ConversationState>;
      if (!Array.isArray(s.items) || typeof s.session !== "string") return fresh();
      if (!s.busy) return { items: s.items, session: s.session, busy: false, lastPrompt: s.lastPrompt };
      // Saved mid-reply (the tab was reloaded): the reply won't continue, so say so and offer to send it again.
      const items = s.items.map((it) => (it.kind === "tool" && it.pending ? { ...it, pending: false } : it));
      return { items: reduce(items, { type: "error", code: "interrupted", message: interrupted }), session: s.session,
               busy: false, lastPrompt: s.lastPrompt };
    } catch {
      return fresh();
    }
  }
}

// One live conversation per key for the whole page, so a view that is left and re-entered (the arena's Brief and
// back, a re-rendered layout) gets the one that may still be streaming, not a copy read back from storage.
const live = new Map<string, Conversation>();

export function conversationFor(key: string, opts: { storage?: Storage | null; interrupted?: string } = {}): Conversation {
  let c = live.get(key);
  if (!c) { c = new Conversation(key, opts.storage === undefined ? defaultStorage() : opts.storage, opts.interrupted); live.set(key, c); }
  return c;
}

/** Sign-out: stop and empty every live conversation and remove every saved one (only the copilot's keys). */
export function forgetConversations(storage: Storage | null = defaultStorage()): void {
  live.forEach((c) => c.clear());
  live.clear();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    keys.forEach((k) => storage.removeItem(k));
  } catch { /* storage unavailable */ }
}
