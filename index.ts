// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { checkAdminKey } from "../_shared/admin.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "item";
}

// Turns a human title/name into a short, unique, URL-safe id by
// appending -2, -3, ... if the base slug is already taken in `table`.
async function uniqueId(table: string, base: string): Promise<string> {
  const baseSlug = slugify(base);
  let candidate = baseSlug;
  let n = 2;
  // Bounded loop — a real collision streak this long is not realistic.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", candidate)
      .maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    candidate = `${baseSlug}-${n}`;
    n++;
  }
  return `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
}

async function addPosition(payload: any) {
  const title = String(payload.title || "").trim();
  if (!title) return { ok: false, error: "invalid_title" };

  let sortOrder = Number(payload.sortOrder);
  if (!Number.isFinite(sortOrder)) {
    const { data: maxRow, error: maxErr } = await supabase
      .from("positions")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) throw maxErr;
    sortOrder = maxRow ? maxRow.sort_order + 1 : 1;
  }

  const id = await uniqueId("positions", title);
  const { error } = await supabase
    .from("positions")
    .insert({ id, title, sort_order: sortOrder });
  if (error) throw error;

  return { ok: true, id };
}

async function updatePosition(payload: any) {
  const id = String(payload.id || "");
  const title = String(payload.title || "").trim();
  const sortOrder = Number(payload.sortOrder);
  if (!id || !title || !Number.isFinite(sortOrder)) {
    return { ok: false, error: "invalid_fields" };
  }

  const { error } = await supabase
    .from("positions")
    .update({ title, sort_order: sortOrder })
    .eq("id", id);
  if (error) throw error;

  return { ok: true };
}

async function deletePosition(payload: any) {
  const id = String(payload.id || "");
  if (!id) return { ok: false, error: "invalid_fields" };

  // Block removal if any vote already references a candidate under
  // this position — deleting it would silently erase cast ballots.
  const { data: candRows, error: candErr } = await supabase
    .from("candidates")
    .select("id")
    .eq("position_id", id);
  if (candErr) throw candErr;

  const candidateIds = (candRows || []).map((c: any) => c.id);
  if (candidateIds.length > 0) {
    const { count: voteCount, error: voteErr } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .in("candidate_id", candidateIds);
    if (voteErr) throw voteErr;
    if (voteCount && voteCount > 0) {
      return { ok: false, error: "has_votes" };
    }
  }

  // No votes exist — safe to delete. candidates cascade automatically
  // (candidates.position_id has ON DELETE CASCADE).
  const { error } = await supabase.from("positions").delete().eq("id", id);
  if (error) throw error;

  return { ok: true };
}

async function addCandidate(payload: any) {
  const positionId = String(payload.positionId || "");
  const name = String(payload.name || "").trim();
  const tag = payload.tag ? String(payload.tag).trim() : null;
  if (!positionId || !name) return { ok: false, error: "invalid_fields" };

  const { data: pos, error: posErr } = await supabase
    .from("positions")
    .select("id")
    .eq("id", positionId)
    .maybeSingle();
  if (posErr) throw posErr;
  if (!pos) return { ok: false, error: "position_not_found" };

  const id = await uniqueId("candidates", `${positionId}-${name}`);
  const { error } = await supabase
    .from("candidates")
    .insert({ id, position_id: positionId, name, tag });
  if (error) throw error;

  return { ok: true, id };
}

async function updateCandidate(payload: any) {
  const id = String(payload.id || "");
  const name = String(payload.name || "").trim();
  const tag = payload.tag ? String(payload.tag).trim() : null;
  if (!id || !name) return { ok: false, error: "invalid_fields" };

  const { error } = await supabase
    .from("candidates")
    .update({ name, tag })
    .eq("id", id);
  if (error) throw error;

  return { ok: true };
}

async function deleteCandidate(payload: any) {
  const id = String(payload.id || "");
  if (!id) return { ok: false, error: "invalid_fields" };

  const { count: voteCount, error: voteErr } = await supabase
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", id);
  if (voteErr) throw voteErr;
  if (voteCount && voteCount > 0) {
    return { ok: false, error: "has_votes" };
  }

  const { error } = await supabase.from("candidates").delete().eq("id", id);
  if (error) throw error;

  return { ok: true };
}

const ACTIONS: Record<string, (payload: any) => Promise<any>> = {
  addPosition,
  updatePosition,
  deletePosition,
  addCandidate,
  updateCandidate,
  deleteCandidate,
};

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const authFail = checkAdminKey(req);
  if (authFail) return authFail;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const action = String(body.action || "");
  const fn = ACTIONS[action];
  if (!fn) {
    return jsonResponse({ ok: false, error: "unknown_action" }, 400);
  }

  try {
    const result = await fn(body);
    return jsonResponse(result, result.ok ? 200 : 400);
  } catch (_e) {
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
});
