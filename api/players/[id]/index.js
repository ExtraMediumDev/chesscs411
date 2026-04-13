const { query } = require("../../../lib/db");

async function getBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

module.exports = async (req, res) => {
  try {
    const { id } = req.query;

    if (req.method === "PUT") {
      const { Name, Country, Gender, Birthday } = await getBody(req);
      if (!Name) return res.status(400).json({ error: "Name is required" });

      const result = await query(
        "UPDATE Players SET Name = ?, Country = ?, Gender = ?, Birthday = ? WHERE player_ID = ?",
        [Name, Country || null, Gender || null, Birthday || null, id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: "Player not found" });
      return res.json({ success: true });
    }

    if (req.method === "DELETE") {
      await query("DELETE FROM TournamentResults WHERE player_ID = ?", [id]);
      await query("DELETE FROM Ratings WHERE player_ID = ?", [id]);
      const result = await query("DELETE FROM Players WHERE player_ID = ?", [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: "Player not found" });
      return res.json({ success: true });
    }

    const rows = await query(
      `SELECT p.player_ID, p.Name, p.Country, p.Gender, p.Birthday,
         MAX(CASE WHEN r.Rating_Type = 'standard' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS standard_rating,
         MAX(CASE WHEN r.Rating_Type = 'rapid' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS rapid_rating,
         MAX(CASE WHEN r.Rating_Type = 'blitz' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS blitz_rating
       FROM Players p
       LEFT JOIN Ratings r ON p.player_ID = r.player_ID
       WHERE p.player_ID = ?
       GROUP BY p.player_ID, p.Name, p.Country, p.Gender, p.Birthday`,
      [id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Player not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
