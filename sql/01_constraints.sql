ALTER TABLE TournamentResults
  ADD CONSTRAINT chk_games_nonneg CHECK (GamesPlayed >= 0 AND GamesWon >= 0);

ALTER TABLE Ratings
  ADD CONSTRAINT chk_rating_range CHECK (Rating BETWEEN 0 AND 3500);
