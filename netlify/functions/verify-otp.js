const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_ATTEMPTS = 5;
const AUTH_TTL_MINUTES = 15;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: "invalid_body" }) };
  }

  const matric = String(body.matric || "").trim().toUpperCase();
  const code = String(body.code || "").trim();

  if (!matric || !code) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: "missing_fields" }) };
  }

  try {
    const { data: otpRow, error: otpErr } = await supabase
      .from("otp_codes")
      .select("code, expires_at, attempts")
      .eq("matric", matric)
      .maybeSingle();
    if (otpErr) throw otpErr;

    if (!otpRow) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "no_code_requested" }) };
    }

    if (new Date(otpRow.expires_at) < new Date()) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "code_expired" }) };
    }

    if (otpRow.attempts >= MAX_ATTEMPTS) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "too_many_attempts" }) };
    }

    if (otpRow.code !== code) {
      await supabase
        .from("otp_codes")
        .update({ attempts: otpRow.attempts + 1 })
        .eq("matric", matric);
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "invalid_code" }) };
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

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "server_error" }) };
  }
};
