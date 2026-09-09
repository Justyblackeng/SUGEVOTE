import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { getPollSettings, isPollClosed } from "../_shared/settings.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAX_ATTEMPTS = 5;
const AUTH_TTL_MINUTES = 15;

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: "invalid_body" }, 400);
  }

  const matric = String(body.matric || "").trim().toUpperCase();
  const code = String(body.code || "").trim();

  if (!matric || !code) {
    return jsonResponse({ ok: false, error: "missing_fields" }, 200);
  }

  try {
    const settings = await getPollSettings(supabase);
    if (isPollClosed(settings)) {
      return jsonResponse({ ok: false, error: "poll_closed" }, 200);
    }

    const { data: otpRow, error: otpErr } = await supabase
      .from("otp_codes")
      .select("code, expires_at, attempts")
      .eq("matric", matric)
      .maybeSingle();
    if (otpErr) throw otpErr;

    if (!otpRow) {
      return jsonResponse({ ok: false, error: "no_code_requested" }, 200);
    }

    if (new Date(otpRow.expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: "code_expired" }, 200);
    }

    if (otpRow.attempts >= MAX_ATTEMPTS) {
      return jsonResponse({ ok: false, error: "too_many_attempts" }, 200);
    }

    if (otpRow.code !== code) {
      await supabase
        .from("otp_codes")
        .update({ attempts: otpRow.attempts + 1 })
        .eq("matric", matric);
      return jsonResponse({ ok: false, error: "invalid_code" }, 200);
    }

    // Correct code — consume it so it can't be reused, and issue a
    // short-lived ticket that submit-vote will require and then
    // delete after the ballot is recorded.
    await supabase.from("otp_codes").delete().eq("matric", matric);

    const expiresAt = new Date(Date.now() + AUTH_TTL_MINUTES * 60 * 1000).toISOString();
    const { error: authErr } = await supabase
      .from("vote_authorizations")
      .upsert({ matric, expires_at: expiresAt });
    if (authErr) throw authErr;

    return jsonResponse({ ok: true }, 200);
  } catch (_e) {
    return jsonResponse({ ok: false, error: "server_error" }, 500);
  }
});
