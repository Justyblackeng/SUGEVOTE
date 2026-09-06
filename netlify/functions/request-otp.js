const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OTP_TTL_MINUTES = 10;

function generateCode() {
  // 6-digit numeric code, zero-padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmail(to, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.OTP_FROM_EMAIL || "SUMAS E-VOTE <onboarding@resend.dev>";

  if (!apiKey) {
    // No email provider configured. In this mode the code is returned
    // directly in the API response (see handler below) so the flow is
    // still testable end-to-end without setting up email. This must
    // not be relied on in production — see README.
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your SUMAS E-VOTE verification code",
      html: `
        <p>Your one-time verification code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
        <p>This code expires in ${OTP_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.</p>
      `,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Email send failed: ${errText}`);
  }

  return { sent: true };
}

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
  const fullName = String(body.fullName || "").trim();
  const faculty = String(body.faculty || "").trim();
  const email = String(body.email || "").trim().toLowerCase();

  if (!matric || !fullName || !faculty || !email) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: "missing_fields" }) };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: "invalid_email" }) };
  }

  try {
    // Already voted?
    const { data: votedRow, error: votedErr } = await supabase
      .from("voted_log")
      .select("matric")
      .eq("matric", matric)
      .maybeSingle();
    if (votedErr) throw votedErr;
    if (votedRow) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: "already_voted" }) };
    }

    // Voter roll check — only enforced if the roll table has entries.
    const { count: rollCount, error: countErr } = await supabase
      .from("voter_roll")
      .select("matric", { count: "exact", head: true });
    if (countErr) throw countErr;

    if (rollCount && rollCount > 0) {
      const { data: rollRow, error: rollErr } = await supabase
        .from("voter_roll")
        .select("matric")
        .eq("matric", matric)
        .maybeSingle();
      if (rollErr) throw rollErr;
      if (!rollRow) {
        return { statusCode: 200, body: JSON.stringify({ ok: false, error: "not_on_roll" }) };
      }
    }

    // Generate and store the code (overwrites any previous unused code for this matric)
    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: upsertErr } = await supabase
      .from("otp_codes")
      .upsert({ matric, code, expires_at: expiresAt, attempts: 0 });
    if (upsertErr) throw upsertErr;

    const emailResult = await sendEmail(email, code);

    const response = { ok: true, emailSent: emailResult.sent };
    if (!emailResult.sent) {
      // Dev-mode fallback only — see sendEmail() comment above.
      response.devCode = code;
    }

    return { statusCode: 200, body: JSON.stringify(response) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "server_error" }) };
  }
};
