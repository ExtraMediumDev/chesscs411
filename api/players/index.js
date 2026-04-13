const { query } = require("../../lib/db");

module.exports = async (req, res) => {
  try {
    const search = req.query.search || "";
    const rows = await query(
      `SELECT p.player_ID, p.Name, p.Country, p.Gender,
         MAX(CASE WHEN r.Rating_Type = 'standard' AND r.RatingDate = '2026-04-01' THEN r.Rating END) AS standard_rating
       FROM Players p
       LEFT JOIN Ratings r ON p.player_ID = r.player_ID
       WHERE p.Name LIKE ?
       GROUP BY p.player_ID, p.Name, p.Country, p.Gender
       ORDER BY standard_rating DESC, p.Name ASC
       LIMIT 25`,
      [`%${search}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
