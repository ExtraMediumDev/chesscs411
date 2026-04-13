const { query } = require("../../../lib/db");

module.exports = async (req, res) => {
  if (req.method !== "DELETE" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { id } = req.query;

    await query("DELETE FROM TournamentResults WHERE player_ID = ?", [id]);
    await query("DELETE FROM Ratings WHERE player_ID = ?", [id]);
    const result = await query("DELETE FROM Players WHERE player_ID = ?", [id]);

    if (result.affectedRows === 0) return res.status(404).json({ error: "Player not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
