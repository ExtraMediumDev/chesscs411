const { query } = require("../../lib/db");

module.exports = async (req, res) => {
  try {
    const rows = await query(
      `SELECT p.Country,
         COUNT(*) AS total_participations,
         SUM(tr.GamesWon) AS total_wins,
         SUM(tr.GamesPlayed) AS total_games,
         ROUND(SUM(tr.GamesWon) / SUM(tr.GamesPlayed), 4) AS win_rate
       FROM Players p
       JOIN TournamentResults tr ON p.player_ID = tr.player_ID
       WHERE tr.GamesPlayed > 1
       GROUP BY p.Country
       ORDER BY win_rate DESC
       LIMIT 15`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
