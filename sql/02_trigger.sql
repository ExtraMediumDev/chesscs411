DROP TRIGGER IF EXISTS trg_cap_games_won;

DELIMITER //

CREATE TRIGGER trg_cap_games_won
BEFORE INSERT ON TournamentResults
FOR EACH ROW
BEGIN
  IF NEW.GamesWon > NEW.GamesPlayed THEN
    SET NEW.GamesWon = NEW.GamesPlayed;
  END IF;
END //

DELIMITER ;
