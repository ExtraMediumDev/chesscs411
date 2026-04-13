const { query } = require("../../../lib/db");

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
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
