import { describe, expect, it } from "vitest";
import { readTheme, themeKey, writeTheme } from "./theme.ts";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("readTheme / writeTheme", () => {
  it("defaults to light", () => {
    expect(readTheme(mem(), "u1")).toBe("light");
  });

  it("round-trips dark and light", () => {
    const s = mem();
    writeTheme(s, "u1", "dark");
    expect(readTheme(s, "u1")).toBe("dark");
    writeTheme(s, "u1", "light");
    expect(readTheme(s, "u1")).toBe("light");
    expect(s.m.size).toBe(0); // light is the default, so nothing is stored
  });

  it("is kept per user, so Alice and Bob can differ in one browser", () => {
    const s = mem();
    writeTheme(s, "bob", "dark");
    expect(readTheme(s, "bob")).toBe("dark");
    expect(readTheme(s, "alice")).toBe("light");
    expect(themeKey("bob")).toBe("theme:bob");
  });

  it("treats anything unexpected as light", () => {
    const s = mem();
    s.setItem("theme:u1", "purple");
    expect(readTheme(s, "u1")).toBe("light");
  });

  it("falls back to light when storage throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(readTheme(broken, "u1")).toBe("light");
    expect(() => writeTheme(broken, "u1", "dark")).not.toThrow();
  });
});
