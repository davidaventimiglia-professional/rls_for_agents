import { describe, expect, it } from "vitest";
import { Conversation, conversationFor, forgetConversations, type SendDeps } from "./conversation.ts";
import type { AgentClient, AgentEvent } from "./types.ts";

// sessionStorage stand-in (the tests run without a DOM).
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

// An agent that replays events, optionally holding the stream open until released.
function fakeAgent(events: AgentEvent[], hold?: Promise<void>) {
  const calls: { jwt: string; session: string; text: string; signal?: AbortSignal }[] = [];
  const agent: AgentClient = {
    connect: async function* () {},
    send: async function* (jwt, session, text, signal) {
      calls.push({ jwt, session, text, signal });
      for (const [i, e] of events.entries()) {
        if (i === 1 && hold) await hold;
        if (signal?.aborted) { const err = new Error("aborted"); err.name = "AbortError"; throw err; }
        yield e;
      }
    },
  };
  return { agent, calls };
}

const deps = (agent: AgentClient, jwt: string | null = "jwt-1"): SendDeps =>
  ({ agent, getJwt: async () => jwt, textFor: (code, raw) => (code === "paused" ? "Paused for now." : raw) });

const REPLY: AgentEvent[] = [{ type: "text", text: "Alice has " }, { type: "text", text: "21." }, { type: "done" }];

describe("Conversation", () => {
  it("sends a turn and shows the reply as it streams, in one bubble", async () => {
    const { agent, calls } = fakeAgent(REPLY);
    const c = new Conversation("ar:alice", memoryStorage());
    await c.send("how many?", deps(agent));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ jwt: "jwt-1", session: c.get().session, text: "how many?" });
    expect(c.get().items).toEqual([{ kind: "user", text: "how many?" }, { kind: "assistant", text: "Alice has 21." }]);
    expect(c.get().busy).toBe(false);
  });

  it("keeps one conversation id across turns, so the agent keeps its context", async () => {
    const { agent, calls } = fakeAgent(REPLY);
    const c = new Conversation("ar:alice", memoryStorage());
    await c.send("one", deps(agent));
    await c.send("two", deps(agent));
    expect(calls[1].session).toBe(calls[0].session);
  });

  it("is busy while a reply streams, and tells subscribers about each change", async () => {
    let release!: () => void;
    const { agent } = fakeAgent(REPLY, new Promise<void>((r) => (release = r)));
    const c = new Conversation("ar:alice", memoryStorage());
    let notified = 0;
    const off = c.subscribe(() => notified++);
    const turn = c.send("how many?", deps(agent));
    await new Promise((r) => setTimeout(r, 0));
    expect(c.get().busy).toBe(true);
    release();
    await turn;
    off();
    expect(c.get().busy).toBe(false);
    expect(notified).toBeGreaterThanOrEqual(3);
  });

  it("survives the view going away: nothing aborts the stream unless the conversation is reset (#40)", async () => {
    let release!: () => void;
    const { agent, calls } = fakeAgent(REPLY, new Promise<void>((r) => (release = r)));
    const c = new Conversation("ar:alice", memoryStorage());
    const off = c.subscribe(() => {});
    const turn = c.send("how many?", deps(agent));
    off();  // the panel unmounts (projector mode toggled, drawer hidden)
    release();
    await turn;
    expect(calls[0].signal?.aborted).toBe(false);
    expect(c.get().items.at(-1)).toEqual({ kind: "assistant", text: "Alice has 21." });
  });

  it("is saved per user and restored from storage, so a reload keeps it", async () => {
    const storage = memoryStorage();
    const { agent } = fakeAgent(REPLY);
    const a = new Conversation("ar:alice", storage);
    await a.send("how many?", deps(agent));
    const again = new Conversation("ar:alice", storage);
    expect(again.get().items).toEqual(a.get().items);
    expect(again.get().session).toBe(a.get().session);
    expect(again.get().lastPrompt).toBe("how many?");
    const bob = new Conversation("ar:bob", storage);
    expect(bob.get().items).toEqual([]);
    expect(bob.get().session).not.toBe(a.get().session);
  });

  it("a conversation saved mid-reply comes back with the reply marked cut off, ready to send again", async () => {
    const storage = memoryStorage();
    const { agent } = fakeAgent(REPLY, new Promise<void>(() => {}));  // never finishes: the tab is reloaded
    const a = new Conversation("ar:alice", storage);
    void a.send("how many?", deps(agent));
    await new Promise((r) => setTimeout(r, 0));
    const again = new Conversation("ar:alice", storage);
    expect(again.get().busy).toBe(false);
    expect(again.get().items.at(-1)).toMatchObject({ kind: "notice", tone: "error", code: "interrupted", retry: true });
  });

  it("resuming after consent continues the same turn: the question isn't repeated and the consent notice goes", async () => {
    const storage = memoryStorage();
    const ask = fakeAgent([{ type: "consent_required", url: "https://consent" }, { type: "done" }]);
    const a = new Conversation("arena:t1", storage);
    await a.send("show my invoices", deps(ask.agent));
    expect(a.get().items.map((x) => x.kind)).toEqual(["user", "notice"]);
    // The consent page is a full navigation: the conversation is read back from storage on return.
    const back = new Conversation("arena:t1", storage);
    const answer = fakeAgent(REPLY);
    await back.send("show my invoices", deps(answer.agent), { resume: true });
    expect(answer.calls).toHaveLength(1);
    expect(back.get().items).toEqual([{ kind: "user", text: "show my invoices" }, { kind: "assistant", text: "Alice has 21." }]);
  });

  it("resuming a message that isn't the one waiting on consent sends it as a new turn", async () => {
    const { agent } = fakeAgent(REPLY);
    const c = new Conversation("arena:t1", memoryStorage());
    await c.send("first", deps(agent));
    await c.send("second", deps(agent), { resume: true });
    expect(c.get().items.filter((x) => x.kind === "user")).toHaveLength(2);
  });

  it("New conversation stops the reply, empties the chat and starts a new conversation id", async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const { agent, calls } = fakeAgent(REPLY, new Promise<void>((r) => (release = r)));
    const c = new Conversation("ar:alice", storage);
    const before = c.get().session;
    const turn = c.send("how many?", deps(agent));
    await new Promise((r) => setTimeout(r, 0));
    c.reset();
    release();
    await turn;
    expect(calls[0].signal?.aborted).toBe(true);
    expect(c.get().items).toEqual([]);
    expect(c.get().busy).toBe(false);
    expect(c.get().session).not.toBe(before);
    expect(new Conversation("ar:alice", storage).get().items).toEqual([]);
  });

  it("clear (sign-out) removes the saved conversation", async () => {
    const storage = memoryStorage();
    const { agent } = fakeAgent(REPLY);
    const c = new Conversation("ar:alice", storage);
    await c.send("how many?", deps(agent));
    c.clear();
    expect(storage.length).toBe(0);
    expect(new Conversation("ar:alice", storage).get().items).toEqual([]);
  });

  it("no signed-in session: the turn shows unauthorized and nothing is sent", async () => {
    const { agent, calls } = fakeAgent(REPLY);
    const c = new Conversation("ar:alice", memoryStorage());
    await c.send("hi", { ...deps(agent, null), textFor: () => "Sign in again." });
    expect(calls).toHaveLength(0);
    expect(c.get().items.at(-1)).toMatchObject({ kind: "notice", code: "unauthorized", text: "Sign in again." });
  });

  it("error events use the app's wording", async () => {
    const { agent } = fakeAgent([{ type: "error", code: "paused", message: "raw runtime text" }]);
    const c = new Conversation("ar:alice", memoryStorage());
    await c.send("hi", deps(agent));
    expect(c.get().items.at(-1)).toMatchObject({ kind: "notice", code: "paused", text: "Paused for now.", retry: true });
  });

  it("works without storage (no key): it still outlives the view, it just isn't saved", async () => {
    const { agent } = fakeAgent(REPLY);
    const c = new Conversation(null);
    await c.send("how many?", deps(agent));
    expect(c.get().items).toHaveLength(2);
  });

  it("unreadable saved data is ignored, not fatal", () => {
    const storage = memoryStorage();
    storage.setItem("copilot:ar:alice", "{not json");
    expect(new Conversation("ar:alice", storage).get().items).toEqual([]);
  });
});

describe("conversationFor and forgetConversations", () => {
  it("hands back the same conversation for the same key, so a page left and re-entered sees the live one", () => {
    const storage = memoryStorage();
    const a = conversationFor("arena:t1", { storage });
    expect(conversationFor("arena:t1", { storage })).toBe(a);
    expect(conversationFor("arena:t2", { storage })).not.toBe(a);
    forgetConversations(storage);
  });

  it("sign-out forgets every conversation: stops replies, empties them and removes what was saved", async () => {
    const storage = memoryStorage();
    storage.setItem("unrelated", "kept");
    let release!: () => void;
    const { agent, calls } = fakeAgent(REPLY, new Promise<void>((r) => (release = r)));
    const a = conversationFor("ar:alice", { storage });
    const turn = a.send("how many?", deps(agent));
    await new Promise((r) => setTimeout(r, 0));
    forgetConversations(storage);
    release();
    await turn;
    expect(calls[0].signal?.aborted).toBe(true);
    expect(a.get().items).toEqual([]);
    expect(storage.getItem("unrelated")).toBe("kept");
    expect(storage.length).toBe(1);
    const next = conversationFor("ar:alice", { storage });
    expect(next).not.toBe(a);
    expect(next.get().items).toEqual([]);
    forgetConversations(storage);
  });
});
