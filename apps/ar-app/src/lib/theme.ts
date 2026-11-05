// Light or dark, chosen per user with the top bar toggle and kept in localStorage, so a browser signed in as Bob
// stays dark across reloads and projector mode while Alice's stays light. Light is the default.
export type Theme = "light" | "dark";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const themeKey = (userId: string) => `theme:${userId}`;

export function readTheme(s: Store, userId: string): Theme {
  try { return s.getItem(themeKey(userId)) === "dark" ? "dark" : "light"; } catch { return "light"; }
}

export function writeTheme(s: Store, userId: string, t: Theme) {
  try {
    if (t === "dark") s.setItem(themeKey(userId), "dark");
    else s.removeItem(themeKey(userId));
  } catch { /* storage blocked: the theme still applies until reload */ }
}
