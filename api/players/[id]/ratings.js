const { query } = require("../../../lib/db");

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    const type = req.query.type || "standard";
    const rows = await query(
      `SELECT RatingDate, Rating FROM Ratings
       WHERE player_ID = ? AND Rating_Type = ?
       ORDER BY RatingDate`,
      [id, type]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
