# Database Design

## Database Implementation

This project implements the Stage 2 chess schema on MySQL 8.4 in Google Cloud SQL. The database was populated with a hybrid dataset: real player and rating data parsed from the official FIDE rating list, plus simple simulated tournament and tournament-result data added because we could not find a clean tournament dataset that matched our schema well enough for the project.

### DDL Commands

```sql
CREATE TABLE Players (
  player_ID INT PRIMARY KEY,
  Name VARCHAR(100),
  Country VARCHAR(50),
  Gender VARCHAR(20),
  Birthday DATE
);

CREATE TABLE Tournaments (
  Tournament_ID INT PRIMARY KEY,
  Tournament_Name VARCHAR(150),
  Location VARCHAR(100),
  Start_Date DATE
);

CREATE TABLE TournamentResults (
  player_ID INT,
  Tournament_ID INT,
  GamesWon INT,
  GamesPlayed INT,
  RatingChange INT,
  PRIMARY KEY (player_ID, Tournament_ID),
  FOREIGN KEY (player_ID) REFERENCES Players(player_ID),
  FOREIGN KEY (Tournament_ID) REFERENCES Tournaments(Tournament_ID)
);

CREATE TABLE Ratings (
  player_ID INT,
  Rating_Type VARCHAR(10),
  RatingDate DATE,
  Rating INT,
  PRIMARY KEY (player_ID, Rating_Type, RatingDate),
  FOREIGN KEY (player_ID) REFERENCES Players(player_ID)
);

-- Entity table
CREATE TABLE UserAccount (
  user_Id INT PRIMARY KEY,
  Username VARCHAR(50),
  Password VARCHAR(255)
);
```

### Row Counts

| Table | Row count |
| --- | ---: |
| Players | 5000 |
| Ratings | 8589 |
| Tournaments | 220 |
| TournamentResults | 5720 |
| UserAccount | 25 |

The counts confirm that at least three main tables have more than 1000 rows: `Players`, `Ratings`, and `TournamentResults` all exceed that threshold.

### Data Generation Method

We used a simple hybrid approach for the data. Real player and rating data came from the official FIDE rating list. The import script read the fixed-width file, extracted fields such as player ID, name, country, gender, birth year, and available ratings, removed duplicates, and kept up to 5000 valid players. For each nonzero standard, rapid, or blitz rating, the script inserted one row into `Ratings`.

We could not find a tournament dataset that matched our schema cleanly, so we created simple simulated tournament data as students. The script generated 220 tournaments with basic names like `Student Sim Tournament 1`, rotating locations from a small list, and generated dates across 2023 to 2026. For each tournament, it selected a set of unique players and then assigned straightforward random values for `GamesPlayed`, `GamesWon`, and `RatingChange` using a seeded pseudo-random generator. The goal was not to build a sophisticated simulation, but to produce consistent sample tournament participation data that fits the schema and satisfies the row-count requirement.

## Advanced Queries And Indexing

## Q1. Countries with strong rapid-player concentration

This query helps the app surface countries that currently have deep pools of strong rapid players, which is useful for leaderboard and regional trend features. This query uses join, group by, having.

```sql
SELECT
  p.Country,
  COUNT(*) AS elite_rapid_players,
  ROUND(AVG(r.Rating), 2) AS avg_rapid_rating
FROM Players p
JOIN Ratings r
  ON p.player_ID = r.player_ID
WHERE r.Rating_Type = 'rapid'
  AND r.Rating >= 2000
GROUP BY p.Country
HAVING COUNT(*) >= 5
ORDER BY avg_rapid_rating DESC, elite_rapid_players DESC
LIMIT 15;
```

Top 15 rows:

| Country | elite_rapid_players | avg_rapid_rating |
| --- | --- | --- |
| UZB | 5 | 2307.80 |
| KAZ | 5 | 2269.40 |
| AZE | 9 | 2221.00 |
| IND | 13 | 2159.69 |
| RUS | 7 | 2140.71 |
| ESP | 6 | 2125.00 |
| IRI | 10 | 2103.50 |
| EGY | 38 | 2092.47 |

Index designs and EXPLAIN ANALYZE cost summary:

| Design | Cost | Notes |
| --- | ---: | --- |
| baseline | 983 | Use only the default primary-key indexes. |
| ratings_filter | 82.9 | Add a composite index on the filtered rating attributes so MySQL can narrow rapid rows before joining. |
| ratings_plus_country | 82.9 | Keep the ratings filter index and add a country index to support grouping on the joined `Players` rows. |
| country_first_variant | 983 | Try a less targeted alternative index ordering to compare whether grouping-first access helps more than rating-first filtering. |

For countries with strong rapid-player concentration, I compared the baseline plan against three non-default indexing designs. I selected `ratings_filter` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design decreased from 983 to 82.9. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.

The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.

Selected final design: `ratings_filter`

EXPLAIN ANALYZE outputs:

### Q1 - baseline

```text
-> Limit: 15 row(s)  (actual time=3.05..3.05 rows=8 loops=1)
    -> Sort: avg_rapid_rating DESC, elite_rapid_players DESC  (actual time=3.05..3.05 rows=8 loops=1)
        -> Filter: (`count(0)` >= 5)  (actual time=3.02..3.03 rows=8 loops=1)
            -> Table scan on <temporary>  (actual time=3.02..3.02 rows=42 loops=1)
                -> Aggregate using temporary table  (actual time=3.02..3.02 rows=42 loops=1)
                    -> Nested loop inner join  (cost=983 rows=286) (actual time=0.23..2.9 rows=146 loops=1)
                        -> Filter: ((r.Rating_Type = 'rapid') and (r.Rating >= 2000))  (cost=883 rows=286) (actual time=0.218..2.66 rows=146 loops=1)
                            -> Table scan on r  (cost=883 rows=8589) (actual time=0.211..1.93 rows=8589 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=0.00151..0.00153 rows=1 loops=146)

```

### Q1 - ratings_filter

```text
-> Limit: 15 row(s)  (actual time=0.49..0.491 rows=8 loops=1)
    -> Sort: avg_rapid_rating DESC, elite_rapid_players DESC  (actual time=0.49..0.49 rows=8 loops=1)
        -> Filter: (`count(0)` >= 5)  (actual time=0.471..0.477 rows=8 loops=1)
            -> Table scan on <temporary>  (actual time=0.47..0.474 rows=42 loops=1)
                -> Aggregate using temporary table  (actual time=0.469..0.469 rows=42 loops=1)
                    -> Nested loop inner join  (cost=82.9 rows=146) (actual time=0.0372..0.344 rows=146 loops=1)
                        -> Filter: ((r.Rating_Type = 'rapid') and (r.Rating >= 2000))  (cost=31.8 rows=146) (actual time=0.0292..0.0917 rows=146 loops=1)
                            -> Covering index range scan on r using idx_ratings_type_rating_player over (Rating_Type = 'rapid' AND 2000 <= Rating)  (cost=31.8 rows=146) (actual time=0.0274..0.0634 rows=146 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.251 rows=1) (actual time=0.00157..0.00159 rows=1 loops=146)

```

### Q1 - ratings_plus_country

```text
-> Limit: 15 row(s)  (actual time=0.45..0.451 rows=8 loops=1)
    -> Sort: avg_rapid_rating DESC, elite_rapid_players DESC  (actual time=0.45..0.45 rows=8 loops=1)
        -> Filter: (`count(0)` >= 5)  (actual time=0.432..0.438 rows=8 loops=1)
            -> Table scan on <temporary>  (actual time=0.431..0.435 rows=42 loops=1)
                -> Aggregate using temporary table  (actual time=0.43..0.43 rows=42 loops=1)
                    -> Nested loop inner join  (cost=82.9 rows=146) (actual time=0.0343..0.331 rows=146 loops=1)
                        -> Filter: ((r.Rating_Type = 'rapid') and (r.Rating >= 2000))  (cost=31.8 rows=146) (actual time=0.0277..0.0869 rows=146 loops=1)
                            -> Covering index range scan on r using idx_ratings_type_rating_player over (Rating_Type = 'rapid' AND 2000 <= Rating)  (cost=31.8 rows=146) (actual time=0.0255..0.0591 rows=146 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.251 rows=1) (actual time=0.00151..0.00153 rows=1 loops=146)

```

### Q1 - country_first_variant

```text
-> Limit: 15 row(s)  (actual time=2.82..2.82 rows=8 loops=1)
    -> Sort: avg_rapid_rating DESC, elite_rapid_players DESC  (actual time=2.81..2.81 rows=8 loops=1)
        -> Filter: (`count(0)` >= 5)  (actual time=2.8..2.8 rows=8 loops=1)
            -> Table scan on <temporary>  (actual time=2.79..2.8 rows=42 loops=1)
                -> Aggregate using temporary table  (actual time=2.79..2.79 rows=42 loops=1)
                    -> Nested loop inner join  (cost=983 rows=286) (actual time=0.124..2.69 rows=146 loops=1)
                        -> Filter: ((r.Rating_Type = 'rapid') and (r.Rating >= 2000))  (cost=883 rows=286) (actual time=0.115..2.45 rows=146 loops=1)
                            -> Covering index scan on r using idx_ratings_player_type_rating  (cost=883 rows=8589) (actual time=0.109..1.69 rows=8589 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=0.00149..0.00151 rows=1 loops=146)

```

## Q2. Players outperforming their country average after recent gains

This query identifies players whose standard ratings are above their own country's average and who have also posted strong aggregate tournament gains recently, which is useful for spotlighting rising performers. This query uses join, group by, subquery.

```sql
SELECT
  p.Name,
  p.Country,
  r.Rating AS standard_rating,
  SUM(tr.RatingChange) AS total_gain
FROM Players p
JOIN Ratings r
  ON p.player_ID = r.player_ID
JOIN TournamentResults tr
  ON p.player_ID = tr.player_ID
JOIN Tournaments t
  ON tr.Tournament_ID = t.Tournament_ID
WHERE r.Rating_Type = 'standard'
  AND r.RatingDate = '2026-04-01'
  AND t.Start_Date >= '2024-01-01'
  AND p.player_ID IN (
    SELECT p3.player_ID
    FROM Players p3
    JOIN Ratings r3
      ON p3.player_ID = r3.player_ID
    WHERE r3.Rating_Type = 'standard'
      AND r3.RatingDate = '2026-04-01'
      AND r3.Rating > (
        SELECT AVG(r2.Rating)
        FROM Ratings r2
        JOIN Players p2
          ON p2.player_ID = r2.player_ID
        WHERE r2.Rating_Type = 'standard'
          AND r2.RatingDate = '2026-04-01'
          AND p2.Country = p3.Country
      )
  )
GROUP BY p.player_ID, p.Name, p.Country, r.Rating
HAVING SUM(tr.RatingChange) >= 10
ORDER BY total_gain DESC, r.Rating DESC
LIMIT 15;
```

Top 15 rows:

| Name | Country | standard_rating | total_gain |
| --- | --- | --- | --- |
| Abella Vazquez, Cesar | ESP | 2113 | 40 |
| Abed, Karim | GER | 2041 | 39 |
| Abelian, Oganes | RUS | 2324 | 36 |
| Abdul, Sonny | FRA | 1905 | 32 |
| Aarish Tickoo | IND | 1607 | 28 |
| Aas, Finn Henrik | NOR | 1882 | 27 |
| Aarush Upganlawar | IND | 1614 | 27 |
| Abduraimov, Server | UZB | 1843 | 26 |
| Abdel Aziz Abdel Ghany, Ahmed | EGY | 1979 | 24 |
| Aangeenbrug, Hans | NED | 1978 | 24 |
| Abdullahi Garba Haruna | UGA | 1915 | 23 |
| Aaron Mrudula Sandeep | IND | 1607 | 23 |
| Abele, Albert | GER | 1985 | 22 |
| Abedraboh, Saed | PLE | 1795 | 22 |
| Abduraimov, Stal | KAZ | 1768 | 22 |

Index designs and EXPLAIN ANALYZE cost summary:

| Design | Cost | Notes |
| --- | ---: | --- |
| baseline | 1060 | Use only the default primary-key indexes. |
| ratings_lookup | 3359 | Add a composite index aligned with the standard-rating filters and the correlated country-average lookup. |
| ratings_and_tournaments | 6891 | Keep the ratings lookup index and add a date-driven tournament index to reduce work in the recent-performance subquery. |
| full_join_path | 6625 | Add indexes across the whole join path, including tournament results by tournament/player, to see whether the aggregation stage benefits from additional support. |

For players outperforming their country average after recent gains, I compared the baseline plan against three non-default indexing designs. I selected `baseline` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design decreased from 1060 to 1060. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.

The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.

Selected final design: `baseline`

EXPLAIN ANALYZE outputs:

### Q2 - baseline

```text
-> Limit: 15 row(s)  (actual time=6642..6642 rows=15 loops=1)
    -> Sort: total_gain DESC, r.Rating DESC  (actual time=6642..6642 rows=15 loops=1)
        -> Filter: (`sum(tr.RatingChange)` >= 10)  (actual time=6642..6642 rows=168 loops=1)
            -> Table scan on <temporary>  (actual time=6642..6642 rows=779 loops=1)
                -> Aggregate using temporary table  (actual time=6642..6642 rows=779 loops=1)
                    -> Nested loop inner join  (cost=1060 rows=48.2) (actual time=2.67..6638 rows=1164 loops=1)
                        -> Nested loop inner join  (cost=1009 rows=145) (actual time=2.67..6635 rows=1561 loops=1)
                            -> Nested loop inner join  (cost=973 rows=85.9) (actual time=1.44..6631 rows=1331 loops=1)
                                -> Nested loop inner join  (cost=943 rows=85.9) (actual time=0.148..13.9 rows=3176 loops=1)
                                    -> Nested loop inner join  (cost=913 rows=85.9) (actual time=0.145..9.4 rows=3176 loops=1)
                                        -> Filter: ((r.RatingDate = DATE'2026-04-01') and (r.Rating_Type = 'standard'))  (cost=883 rows=85.9) (actual time=0.137..4.08 rows=3176 loops=1)
                                            -> Table scan on r  (cost=883 rows=8589) (actual time=0.133..2.3 rows=8589 loops=1)
                                        -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.251 rows=1) (actual time=0.00151..0.00153 rows=1 loops=3176)
                                    -> Single-row index lookup on p3 using PRIMARY (player_ID=r.player_ID)  (cost=0.251 rows=1) (actual time=0.00125..0.00127 rows=1 loops=3176)
                                -> Filter: (r3.Rating > (select #3))  (cost=0.251 rows=1) (actual time=2.08..2.08 rows=0.419 loops=3176)
                                    -> Single-row index lookup on r3 using PRIMARY (player_ID=r.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.251 rows=1) (actual time=0.00202..0.00205 rows=1 loops=3176)
                                    -> Select #3 (subquery in condition; dependent)
                                        -> Aggregate: avg(r2.Rating)  (cost=277 rows=1) (actual time=2.08..2.08 rows=1 loops=3176)
                                            -> Nested loop inner join  (cost=227 rows=491) (actual time=0.241..2.05 rows=301 loops=3176)
                                                -> Filter: (p2.Country = p3.Country)  (cost=55.6 rows=491) (actual time=0.238..1.23 rows=450 loops=3176)
                                                    -> Table scan on p2  (cost=55.6 rows=4910) (actual time=0.0217..0.926 rows=5000 loops=3176)
                                                -> Single-row index lookup on r2 using PRIMARY (player_ID=p2.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00172..0.00173 rows=0.668 loops=1.43e+6)
                            -> Index lookup on tr using PRIMARY (player_ID=r.player_ID)  (cost=0.252 rows=1.68) (actual time=0.002..0.00245 rows=1.17 loops=1331)
                        -> Filter: (t.Start_Date >= DATE'2024-01-01')  (cost=0.25 rows=0.333) (actual time=0.00162..0.00167 rows=0.746 loops=1561)
                            -> Single-row index lookup on t using PRIMARY (Tournament_ID=tr.Tournament_ID)  (cost=0.25 rows=1) (actual time=0.00138..0.0014 rows=1 loops=1561)

```

### Q2 - ratings_lookup

```text
-> Limit: 15 row(s)  (actual time=5756..5756 rows=15 loops=1)
    -> Sort: total_gain DESC, r.Rating DESC  (actual time=5756..5756 rows=15 loops=1)
        -> Filter: (`sum(tr.RatingChange)` >= 10)  (actual time=5755..5755 rows=168 loops=1)
            -> Table scan on <temporary>  (actual time=5755..5755 rows=779 loops=1)
                -> Aggregate using temporary table  (actual time=5755..5755 rows=779 loops=1)
                    -> Nested loop inner join  (cost=3359 rows=1906) (actual time=1.58..5752 rows=1164 loops=1)
                        -> Nested loop inner join  (cost=2691 rows=1906) (actual time=0.0953..29.2 rows=2744 loops=1)
                            -> Nested loop inner join  (cost=2024 rows=1906) (actual time=0.0906..24.9 rows=2744 loops=1)
                                -> Nested loop inner join  (cost=1357 rows=1906) (actual time=0.0872..19.2 rows=2744 loops=1)
                                    -> Nested loop inner join  (cost=690 rows=1906) (actual time=0.0798..9.3 rows=4290 loops=1)
                                        -> Filter: (t.Start_Date >= DATE'2024-01-01')  (cost=22.2 rows=73.3) (actual time=0.0179..0.432 rows=165 loops=1)
                                            -> Table scan on t  (cost=22.2 rows=220) (actual time=0.0164..0.227 rows=220 loops=1)
                                        -> Index lookup on tr using idx_results_tournament_id_only (Tournament_ID=t.Tournament_ID)  (cost=6.54 rows=26) (actual time=0.0459..0.0518 rows=26 loops=165)
                                    -> Single-row index lookup on r using PRIMARY (player_ID=tr.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00218..0.00219 rows=0.64 loops=4290)
                                -> Single-row index lookup on r3 using PRIMARY (player_ID=tr.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00193..0.00195 rows=1 loops=2744)
                            -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00142..0.00144 rows=1 loops=2744)
                        -> Filter: (r3.Rating > (select #3))  (cost=0.25 rows=1) (actual time=2.09..2.09 rows=0.424 loops=2744)
                            -> Single-row index lookup on p3 using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00128..0.00131 rows=1 loops=2744)
                            -> Select #3 (subquery in condition; dependent)
                                -> Aggregate: avg(r2.Rating)  (cost=277 rows=1) (actual time=2.08..2.08 rows=1 loops=2744)
                                    -> Nested loop inner join  (cost=227 rows=491) (actual time=0.241..2.05 rows=299 loops=2744)
                                        -> Filter: (p2.Country = p3.Country)  (cost=55.6 rows=491) (actual time=0.238..1.23 rows=448 loops=2744)
                                            -> Table scan on p2  (cost=55.6 rows=4910) (actual time=0.0216..0.926 rows=5000 loops=2744)
                                        -> Single-row index lookup on r2 using PRIMARY (player_ID=p2.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00171..0.00173 rows=0.668 loops=1.23e+6)

```

### Q2 - ratings_and_tournaments

```text
-> Limit: 15 row(s)  (actual time=6645..6645 rows=15 loops=1)
    -> Sort: total_gain DESC, r.Rating DESC  (actual time=6645..6645 rows=15 loops=1)
        -> Filter: (`sum(tr.RatingChange)` >= 10)  (actual time=6644..6644 rows=168 loops=1)
            -> Table scan on <temporary>  (actual time=6644..6644 rows=779 loops=1)
                -> Aggregate using temporary table  (actual time=6644..6644 rows=779 loops=1)
                    -> Nested loop inner join  (cost=6891 rows=4011) (actual time=2669..6641 rows=1164 loops=1)
                        -> Nested loop inner join  (cost=5020 rows=5348) (actual time=2618..6639 rows=1561 loops=1)
                            -> Nested loop inner join  (cost=3691 rows=3176) (actual time=2618..6635 rows=1331 loops=1)
                                -> Nested loop inner join  (cost=2579 rows=3176) (actual time=0.096..14.4 rows=3176 loops=1)
                                    -> Nested loop inner join  (cost=1468 rows=3176) (actual time=0.0902..9.42 rows=3176 loops=1)
                                        -> Covering index lookup on r using idx_ratings_type_date_rating_player (Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=356 rows=3176) (actual time=0.0818..1.32 rows=3176 loops=1)
                                        -> Single-row index lookup on r3 using PRIMARY (player_ID=r.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00238..0.0024 rows=1 loops=3176)
                                    -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=0.0014..0.00142 rows=1 loops=3176)
                                -> Filter: (r3.Rating > (select #3))  (cost=0.25 rows=1) (actual time=2.08..2.08 rows=0.419 loops=3176)
                                    -> Single-row index lookup on p3 using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=0.00126..0.00128 rows=1 loops=3176)
                                    -> Select #3 (subquery in condition; dependent)
                                        -> Aggregate: avg(r2.Rating)  (cost=277 rows=1) (actual time=2.08..2.08 rows=1 loops=3176)
                                            -> Nested loop inner join  (cost=227 rows=491) (actual time=0.241..2.05 rows=301 loops=3176)
                                                -> Filter: (p2.Country = p3.Country)  (cost=55.6 rows=491) (actual time=0.238..1.23 rows=450 loops=3176)
                                                    -> Table scan on p2  (cost=55.6 rows=4910) (actual time=0.0216..0.924 rows=5000 loops=3176)
                                                -> Single-row index lookup on r2 using PRIMARY (player_ID=p2.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00172..0.00173 rows=0.668 loops=1.43e+6)
                            -> Index lookup on tr using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1.68) (actual time=0.00221..0.00262 rows=1.17 loops=1331)
                        -> Filter: (t.Start_Date >= DATE'2024-01-01')  (cost=0.25 rows=0.75) (actual time=0.00142..0.00146 rows=0.746 loops=1561)
                            -> Single-row index lookup on t using PRIMARY (Tournament_ID=tr.Tournament_ID)  (cost=0.25 rows=1) (actual time=0.00122..0.00124 rows=1 loops=1561)

```

### Q2 - full_join_path

```text
-> Limit: 15 row(s)  (actual time=2708..2708 rows=15 loops=1)
    -> Sort: total_gain DESC, r.Rating DESC  (actual time=2708..2708 rows=15 loops=1)
        -> Filter: (`sum(tr.RatingChange)` >= 10)  (actual time=2708..2708 rows=168 loops=1)
            -> Table scan on <temporary>  (actual time=2708..2708 rows=779 loops=1)
                -> Aggregate using temporary table  (actual time=2708..2708 rows=779 loops=1)
                    -> Nested loop inner join  (cost=6625 rows=4290) (actual time=0.256..2705 rows=1164 loops=1)
                        -> Nested loop inner join  (cost=5124 rows=4290) (actual time=0.0446..22.2 rows=2744 loops=1)
                            -> Nested loop inner join  (cost=3622 rows=4290) (actual time=0.0406..16.9 rows=2744 loops=1)
                                -> Nested loop inner join  (cost=2121 rows=4290) (actual time=0.0376..11.2 rows=2744 loops=1)
                                    -> Nested loop inner join  (cost=619 rows=4290) (actual time=0.0305..2.14 rows=4290 loops=1)
                                        -> Filter: (t.Start_Date >= DATE'2024-01-01')  (cost=33.3 rows=165) (actual time=0.0203..0.309 rows=165 loops=1)
                                            -> Covering index range scan on t using idx_tournaments_date_id over ('2024-01-01' <= Start_Date)  (cost=33.3 rows=165) (actual time=0.0195..0.18 rows=165 loops=1)
                                        -> Covering index lookup on tr using idx_results_tournament_player_gain (Tournament_ID=t.Tournament_ID)  (cost=0.966 rows=26) (actual time=0.00559..0.00939 rows=26 loops=165)
                                    -> Single-row index lookup on r using PRIMARY (player_ID=tr.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00199..0.002 rows=0.64 loops=4290)
                                -> Single-row index lookup on r3 using PRIMARY (player_ID=tr.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.25 rows=1) (actual time=0.00192..0.00194 rows=1 loops=2744)
                            -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.0018..0.00183 rows=1 loops=2744)
                        -> Filter: (r3.Rating > (select #3))  (cost=0.25 rows=1) (actual time=0.978..0.978 rows=0.424 loops=2744)
                            -> Single-row index lookup on p3 using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00123..0.00126 rows=1 loops=2744)
                            -> Select #3 (subquery in condition; dependent)
                                -> Aggregate: avg(r2.Rating)  (cost=22.4 rows=1) (actual time=0.975..0.975 rows=1 loops=2744)
                                    -> Nested loop inner join  (cost=18.6 rows=37.8) (actual time=0.00595..0.955 rows=299 loops=2744)
                                        -> Covering index lookup on p2 using idx_players_country_player (Country=p3.Country)  (cost=5.43 rows=37.8) (actual time=0.00347..0.134 rows=448 loops=2744)
                                        -> Single-row index lookup on r2 using PRIMARY (player_ID=p2.player_ID, Rating_Type='standard', RatingDate=DATE'2026-04-01')  (cost=0.253 rows=1) (actual time=0.00172..0.00174 rows=0.668 loops=1.23e+6)

```

## Q3. Countries producing standout players by rating or event surge

This query supports country-comparison views by combining two ways to be notable: already having a very high standard rating or posting a big recent tournament jump. This query uses join, set operator, group by.

```sql
SELECT
  p.Country,
  COUNT(DISTINCT p.player_ID) AS standout_players
FROM Players p
WHERE p.player_ID IN (
  SELECT r.player_ID
  FROM Ratings r
  WHERE r.Rating_Type = 'standard'
    AND r.Rating >= 2400

  UNION

  SELECT tr.player_ID
  FROM TournamentResults tr
  JOIN Tournaments t
    ON tr.Tournament_ID = t.Tournament_ID
  WHERE t.Start_Date >= '2025-01-01'
    AND tr.RatingChange >= 20
)
GROUP BY p.Country
HAVING COUNT(DISTINCT p.player_ID) >= 2
ORDER BY standout_players DESC, p.Country
LIMIT 15;
```

Top 15 rows:

| Country | standout_players |
| --- | --- |
| IND | 4 |
| AZE | 2 |
| UZB | 2 |

Index designs and EXPLAIN ANALYZE cost summary:

| Design | Cost | Notes |
| --- | ---: | --- |
| baseline | 988 | Use only the default primary-key indexes. |
| rating_arm | 988 | Add a composite index to accelerate the first half of the union, which filters on rating type and threshold before joining back to players. |
| rating_and_recent_events | 988 | Add a tournament date index so the event-surge half of the union can prune older tournaments earlier. |
| full_union_support | 982 | Add a result-path index and a country index to support both halves of the union plus the final grouping step. |

For countries producing standout players by rating or event surge, I compared the baseline plan against three non-default indexing designs. I selected `full_union_support` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design decreased from 988 to 982. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.

The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.

Selected final design: `full_union_support`

EXPLAIN ANALYZE outputs:

### Q3 - baseline

```text
-> Limit: 15 row(s)  (actual time=26.7..26.7 rows=3 loops=1)
    -> Sort: standout_players DESC, p.Country  (actual time=26.7..26.7 rows=3 loops=1)
        -> Filter: (`count(distinct p.player_ID)` >= 2)  (actual time=26.7..26.7 rows=3 loops=1)
            -> Stream results  (cost=988 rows=70.1) (actual time=26.7..26.7 rows=7 loops=1)
                -> Group aggregate: count(distinct p.player_ID), count(distinct p.player_ID)  (cost=988 rows=70.1) (actual time=26.7..26.7 rows=7 loops=1)
                    -> Sort: p.Country  (cost=498 rows=4910) (actual time=26.7..26.7 rows=12 loops=1)
                        -> Filter: <in_optimizer>(p.player_ID,<exists>(select #2))  (cost=498 rows=4910) (actual time=0.307..26.7 rows=12 loops=1)
                            -> Table scan on p  (cost=498 rows=4910) (actual time=0.0664..0.942 rows=5000 loops=1)
                            -> Select #2 (subquery in condition; dependent)
                                -> Limit: 1 row(s)  (cost=3.34..3.34 rows=0.52) (actual time=0.00475..0.00475 rows=0.0024 loops=5000)
                                    -> Table scan on <union temporary>  (cost=3.34..3.34 rows=0.52) (actual time=0.00464..0.00464 rows=0.0024 loops=5000)
                                        -> Union materialize with deduplication  (cost=0.838..0.838 rows=0.52) (actual time=0.0045..0.0045 rows=0.0024 loops=5000)
                                            -> Limit table size: 1 unique row(s)
                                                -> Limit: 1 row(s)  (cost=0.283 rows=0.333) (actual time=0.00227..0.00227 rows=0.0024 loops=5000)
                                                    -> Filter: (r.Rating >= 2400)  (cost=0.283 rows=0.333) (actual time=0.00219..0.00219 rows=0.0024 loops=5000)
                                                        -> Index lookup on r using PRIMARY (player_ID=<cache>(p.player_ID), Rating_Type='standard')  (cost=0.283 rows=1) (actual time=0.00183..0.00205 rows=0.635 loops=5000)
                                            -> Limit table size: 1 unique row(s)
                                                -> Limit: 1 row(s)  (cost=0.503 rows=0.187) (actual time=0.00201..0.00201 rows=0 loops=4988)
                                                    -> Nested loop inner join  (cost=0.503 rows=0.187) (actual time=0.00192..0.00192 rows=0 loops=4988)
                                                        -> Filter: (tr.RatingChange >= 20)  (cost=0.306 rows=0.561) (actual time=0.00184..0.00184 rows=0 loops=4988)
                                                            -> Index lookup on tr using PRIMARY (player_ID=<cache>(p.player_ID))  (cost=0.306 rows=1.68) (actual time=0.00136..0.00169 rows=1.14 loops=4988)
                                                        -> Filter: (t.Start_Date >= DATE'2025-01-01')  (cost=0.309 rows=0.333) (never executed)
                                                            -> Single-row index lookup on t using PRIMARY (Tournament_ID=tr.Tournament_ID)  (cost=0.309 rows=1) (never executed)

```

### Q3 - rating_arm

```text
-> Limit: 15 row(s)  (actual time=27.2..27.2 rows=3 loops=1)
    -> Sort: standout_players DESC, p.Country  (actual time=27.2..27.2 rows=3 loops=1)
        -> Filter: (`count(distinct p.player_ID)` >= 2)  (actual time=27.2..27.2 rows=3 loops=1)
            -> Stream results  (cost=988 rows=70.1) (actual time=27.2..27.2 rows=7 loops=1)
                -> Group aggregate: count(distinct p.player_ID), count(distinct p.player_ID)  (cost=988 rows=70.1) (actual time=27.2..27.2 rows=7 loops=1)
                    -> Sort: p.Country  (cost=498 rows=4910) (actual time=27.2..27.2 rows=12 loops=1)
                        -> Filter: <in_optimizer>(p.player_ID,<exists>(select #2))  (cost=498 rows=4910) (actual time=0.296..27.1 rows=12 loops=1)
                            -> Table scan on p  (cost=498 rows=4910) (actual time=0.054..0.941 rows=5000 loops=1)
                            -> Select #2 (subquery in condition; dependent)
                                -> Limit: 1 row(s)  (cost=3.34..3.34 rows=0.52) (actual time=0.00483..0.00483 rows=0.0024 loops=5000)
                                    -> Table scan on <union temporary>  (cost=3.34..3.34 rows=0.52) (actual time=0.00472..0.00472 rows=0.0024 loops=5000)
                                        -> Union materialize with deduplication  (cost=0.838..0.838 rows=0.52) (actual time=0.00458..0.00458 rows=0.0024 loops=5000)
                                            -> Limit table size: 1 unique row(s)
                                                -> Limit: 1 row(s)  (cost=0.283 rows=0.333) (actual time=0.00233..0.00233 rows=0.0024 loops=5000)
                                                    -> Filter: (r.Rating >= 2400)  (cost=0.283 rows=0.333) (actual time=0.00224..0.00224 rows=0.0024 loops=5000)
                                                        -> Index lookup on r using PRIMARY (player_ID=<cache>(p.player_ID), Rating_Type='standard')  (cost=0.283 rows=1) (actual time=0.00188..0.0021 rows=0.635 loops=5000)
                                            -> Limit table size: 1 unique row(s)
                                                -> Limit: 1 row(s)  (cost=0.503 rows=0.187) (actual time=0.00203..0.00203 rows=0 loops=4988)
                                                    -> Nested loop inner join  (cost=0.503 rows=0.187) (actual time=0.00193..0.00193 rows=0 loops=4988)
                                                        -> Filter: (tr.RatingChange >= 20)  (cost=0.306 rows=0.561) (actual time=0.00185..0.00185 rows=0 loops=4988)
                                                            -> Index lookup on tr using PRIMARY (player_ID=<cache>(p.player_ID))  (cost=0.306 rows=1.68) (actual time=0.00138..0.00171 rows=1.14 loops=4988)
                                                        -> Filter: (t.Start_Date >= DATE'2025-01-01')  (cost=0.309 rows=0.333) (never executed)
                                                            -> Single-row index lookup on t using PRIMARY (Tournament_ID=tr.Tournament_ID)  (cost=0.309 rows=1) (never executed)

```

### Q3 - rating_and_recent_events

```text
-> Limit: 15 row(s)  (actual time=26.9..26.9 rows=3 loops=1)
    -> Sort: standout_players DESC, p.Country  (actual time=26.9..26.9 rows=3 loops=1)
        -> Filter: (`count(distinct p.player_ID)` >= 2)  (actual time=26.9..26.9 rows=3 loops=1)
            -> Stream results  (cost=988 rows=70.1) (actual time=26.9..26.9 rows=7 loops=1)
                -> Group aggregate: count(distinct p.player_ID), count(distinct p.player_ID)  (cost=988 rows=70.1) (actual time=26.9..26.9 rows=7 loops=1)
                    -> Sort: p.Country  (cost=498 rows=4910) (actual time=26.9..26.9 rows=12 loops=1)
                        -> Filter: <in_optimizer>(p.player_ID,<exists>(select #2))  (cost=498 rows=4910) (actual time=0.324..26.9 rows=12 loops=1)
                            -> Table scan on p  (cost=498 rows=4910) (actual time=0.0564..0.974 rows=5000 loops=1)
                            -> Select #2 (subquery in condition; dependent)
                                -> Limit: 1 row(s)  (cost=3.35..3.35 rows=0.614) (actual time=0.00478..0.00478 rows=0.0024 loops=5000)
                                    -> Table scan on <union temporary>  (cost=3.35..3.35 rows=0.614) (actual time=0.00467..0.00467 rows=0.0024 loops=5000)
                                        -> Union materialize with deduplication  (cost=0.847..0.847 rows=0.614) (actual time=0.00453..0.00453 rows=0.0024 loops=5000)
                                            -> Limit table size: 1 unique row(s)
                                                -> Limit: 1 row(s)  (cost=0.283 rows=0.333) (actual time=0.00229..0.00229 rows=0.0024 loops=5000)
                                                    -> Filter: (r.Rating >= 2400)  (cost=0.283 rows=0.333) (actual time=0.0022..0.0022 rows=0.0024 loops=5000)
                                                        -> Index lookup on r using PRIMARY (player_ID=<cache>(p.player_ID), Rating_Type='standard')  (cost=0.283 rows=1) (actual time=0.00185..0.00206 rows=0.635 loops=5000)
                                            -> Limit table size: 1 unique row(s)
                                                -> Limit: 1 row(s)  (cost=0.503 rows=0.281) (actual time=0.00202..0.00202 rows=0 loops=4988)
                                                    -> Nested loop inner join  (cost=0.503 rows=0.281) (actual time=0.00193..0.00193 rows=0 loops=4988)
                                                        -> Filter: (tr.RatingChange >= 20)  (cost=0.306 rows=0.561) (actual time=0.00184..0.00184 rows=0 loops=4988)
                                                            -> Index lookup on tr using PRIMARY (player_ID=<cache>(p.player_ID))  (cost=0.306 rows=1.68) (actual time=0.00137..0.0017 rows=1.14 loops=4988)
                                                        -> Filter: (t.Start_Date >= DATE'2025-01-01')  (cost=0.339 rows=0.5) (never executed)
                                                            -> Single-row index lookup on t using PRIMARY (Tournament_ID=tr.Tournament_ID)  (cost=0.339 rows=1) (never executed)

```

### Q3 - full_union_support

```text
-> Limit: 15 row(s)  (actual time=28.6..28.6 rows=3 loops=1)
    -> Sort: standout_players DESC, p.Country  (actual time=28.6..28.6 rows=3 loops=1)
        -> Filter: (`count(distinct p.player_ID)` >= 2)  (actual time=2.68..28.6 rows=3 loops=1)
            -> Stream results  (cost=982 rows=130) (actual time=2.68..28.6 rows=7 loops=1)
                -> Group aggregate: count(distinct p.player_ID), count(distinct p.player_ID)  (cost=982 rows=130) (actual time=2.68..28.6 rows=7 loops=1)
                    -> Filter: <in_optimizer>(p.player_ID,<exists>(select #2))  (cost=491 rows=4911) (actual time=0.562..28.6 rows=12 loops=1)
                        -> Covering index skip scan for deduplication on p using idx_players_country_player  (cost=491 rows=4911) (actual time=0.0105..2.32 rows=5000 loops=1)
                        -> Select #2 (subquery in condition; dependent)
                            -> Limit: 1 row(s)  (cost=3.35..3.35 rows=0.614) (actual time=0.00482..0.00482 rows=0.0024 loops=5000)
                                -> Table scan on <union temporary>  (cost=3.35..3.35 rows=0.614) (actual time=0.00472..0.00472 rows=0.0024 loops=5000)
                                    -> Union materialize with deduplication  (cost=0.847..0.847 rows=0.614) (actual time=0.00457..0.00457 rows=0.0024 loops=5000)
                                        -> Limit table size: 1 unique row(s)
                                            -> Limit: 1 row(s)  (cost=0.283 rows=0.333) (actual time=0.00232..0.00232 rows=0.0024 loops=5000)
                                                -> Filter: (r.Rating >= 2400)  (cost=0.283 rows=0.333) (actual time=0.00224..0.00224 rows=0.0024 loops=5000)
                                                    -> Index lookup on r using PRIMARY (player_ID=<cache>(p.player_ID), Rating_Type='standard')  (cost=0.283 rows=1) (actual time=0.00188..0.00209 rows=0.635 loops=5000)
                                        -> Limit table size: 1 unique row(s)
                                            -> Limit: 1 row(s)  (cost=0.503 rows=0.281) (actual time=0.00204..0.00204 rows=0 loops=4988)
                                                -> Nested loop inner join  (cost=0.503 rows=0.281) (actual time=0.00195..0.00195 rows=0 loops=4988)
                                                    -> Filter: (tr.RatingChange >= 20)  (cost=0.306 rows=0.561) (actual time=0.00187..0.00187 rows=0 loops=4988)
                                                        -> Index lookup on tr using PRIMARY (player_ID=<cache>(p.player_ID))  (cost=0.306 rows=1.68) (actual time=0.0014..0.00173 rows=1.14 loops=4988)
                                                    -> Filter: (t.Start_Date >= DATE'2025-01-01')  (cost=0.339 rows=0.5) (never executed)
                                                        -> Single-row index lookup on t using PRIMARY (Tournament_ID=tr.Tournament_ID)  (cost=0.339 rows=1) (never executed)

```
