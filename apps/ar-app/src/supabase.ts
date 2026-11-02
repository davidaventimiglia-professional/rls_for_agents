import { createClient } from "@supabase/supabase-js";
import { forgetConversations } from "@ar/shared/agent/conversation.ts";

// First-party browser session (no client_id in the JWT). The publishable key only identifies the
// project; RLS decides everything.
export const sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

// Signing out (from any page, or a session that ends) forgets the copilot's conversations, so the next person to
// sign in on this tab never sees them (#40).
sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") forgetConversations(); });
