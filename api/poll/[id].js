// api/poll/[id].js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "GET") {
    // Fetch poll and options
    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("*")
      .eq("id", id)
      .single();

    if (pollError || !poll) return res.status(404).json({ error: "Poll not found" });

    const { data: options } = await supabase
      .from("options")
      .select("*")
      .eq("poll_id", id);

    return res.status(200).json({ poll, options });
  }

  if (req.method === "POST") {
    // Handle vote submission
    try {
      const { choices, voter_uuid } = req.body;

      if (!choices || choices.length === 0)
        return res.status(400).json({ error: "No options selected" });

      // Insert votes
      const { error: voteError } = await supabase
        .from("votes")
        .insert(
          choices.map((opt) => ({
            poll_id: id,
            option_id: opt,
            voter_uuid,
          }))
        );

      if (voteError) throw voteError;

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Error submitting vote:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
