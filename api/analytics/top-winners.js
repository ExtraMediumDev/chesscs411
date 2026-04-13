const { query } = require("../../lib/db");

module.exports = async (req, res) => {
  try {
    const rows = await query(
      `SELECT p.player_ID, p.Name,
         COUNT(*) AS tournaments_played,
         SUM(tr.GamesWon) AS total_wins,
         SUM(tr.GamesPlayed) AS total_games
       FROM Players p
       JOIN TournamentResults tr ON p.player_ID = tr.player_ID
       GROUP BY p.player_ID, p.Name
       HAVING SUM(tr.GamesPlayed) > 0
       ORDER BY total_wins DESC
       LIMIT 15`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
