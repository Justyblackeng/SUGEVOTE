const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async () => {
  try {
    const { count: turnout, error: turnoutErr } = await supabase
      .from("voted_log")
      .select("matric", { count: "exact", head: true });

    if (turnoutErr) throw turnoutErr;

    const { count: rollCount, error: rollErr } = await supabase
      .from("voter_roll")
      .select("matric", { count: "exact", head: true });

    if (rollErr) throw rollErr;

    const totalRoll = rollCount && rollCount > 0
      ? rollCount
      : Number(process.env.TOTAL_ROLL_FALLBACK || 320);

    return {
      statusCode: 200,
      body: JSON.stringify({ turnout: turnout || 0, totalRoll }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "server_error" }) };
  }
};
