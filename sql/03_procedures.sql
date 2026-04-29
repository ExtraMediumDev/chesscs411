DROP PROCEDURE IF EXISTS sp_country_report;
DROP PROCEDURE IF EXISTS sp_record_result;

DELIMITER //

CREATE PROCEDURE sp_country_report(IN p_country VARCHAR(50))
BEGIN
  DECLARE n_players INT DEFAULT 0;

  SELECT COUNT(*) INTO n_players FROM Players WHERE Country = p_country;

  IF n_players = 0 THEN
    SELECT p_country AS Country, 'no players found' AS note, NULL AS win_rate, NULL AS top_growth;
  ELSE
    SELECT
      p.Country,
      COUNT(*) AS total_participations,
      SUM(tr.GamesWon) AS total_wins,
      SUM(tr.GamesPlayed) AS total_games,
      SUM(tr.GamesWon) / SUM(tr.GamesPlayed) AS win_rate
    FROM Players p
    JOIN TournamentResults tr ON tr.player_ID = p.player_ID
    WHERE p.Country = p_country AND tr.GamesPlayed > 0
    GROUP BY p.Country
    HAVING SUM(tr.GamesPlayed) > 0;

    SELECT
      p.player_ID,
      p.Name,
      MAX(r.Rating) - MIN(r.Rating) AS rating_growth
    FROM Players p
    JOIN Ratings r ON r.player_ID = p.player_ID
    WHERE p.Country = p_country
      AND r.Rating_Type = 'standard'
      AND r.RatingDate BETWEEN '2020-01-01' AND '2025-12-31'
    GROUP BY p.player_ID, p.Name
    ORDER BY rating_growth DESC
    LIMIT 3;
  END IF;
END //

CREATE PROCEDURE sp_record_result(
  IN p_player_id    INT,
  IN p_tourney_id   INT,
  IN p_games_played INT,
  IN p_games_won    INT,
  IN p_rating_change INT
)
BEGIN
  DECLARE v_old_rating INT;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT r.Rating INTO v_old_rating
  FROM Ratings r
  WHERE r.player_ID = p_player_id
    AND r.Rating_Type = 'standard'
    AND r.RatingDate = (
      SELECT MAX(r2.RatingDate)
      FROM Ratings r2
      WHERE r2.player_ID = p_player_id
        AND r2.Rating_Type = 'standard'
    );

  INSERT INTO TournamentResults (player_ID, Tournament_ID, GamesPlayed, GamesWon, RatingChange)
  VALUES (p_player_id, p_tourney_id, p_games_played, p_games_won, p_rating_change);

  INSERT INTO Ratings (player_ID, Rating_Type, RatingDate, Rating)
  SELECT p_player_id, 'standard', t.Start_Date, COALESCE(v_old_rating, 1500) + p_rating_change
  FROM Tournaments t
  WHERE t.Tournament_ID = p_tourney_id;

  COMMIT;
END //

DELIMITER ;
