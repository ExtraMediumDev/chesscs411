# Database Design

## Database Implementation

This project implements the Stage 2 chess schema on MySQL 8.4 in Google Cloud SQL. The database was populated with a hybrid dataset: real player and rating data parsed from the official FIDE rating list, plus simple simulated tournament and tournament-result data added because we could not find a clean tournament dataset that matched our schema well enough for the project.

### Connection Screenshot

![Database connection screenshot](screenshots/connection-check.svg)

### DDL Commands

```sql
-- Entity table
CREATE TABLE Players (
  player_ID INT PRIMARY KEY,
  Name VARCHAR(100),
  Country VARCHAR(50),
  Gender VARCHAR(20),
  Birthday DATE
);

-- Entity table
CREATE TABLE Tournaments (
  Tournament_ID INT PRIMARY KEY,
  Tournament_Name VARCHAR(150),
  Location VARCHAR(100),
  Start_Date DATE
);

-- Relationship table for the many-to-many Players <-> Tournaments relationship
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

-- Relationship/history table for player ratings over type and date
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
| Ratings | 27645 |
| Tournaments | 220 |
| TournamentResults | 5720 |
| UserAccount | 25 |

The counts confirm that at least three main tables have more than 1000 rows: `Players`, `Ratings`, and `TournamentResults` all exceed that threshold.

Screenshot of row counts:

![Row count screenshot](screenshots/row-counts.svg)

### Data Generation Method

We used a simple hybrid approach for the data. Real player data and the current rating snapshot came from the official FIDE rating list. The import script read the fixed-width file, extracted fields such as player ID, name, country, gender, birth year, and available ratings, removed duplicates, and kept up to 5000 valid players. The 2026 standard, rapid, and blitz values came directly from that file.

We could not find a tournament dataset that matched our schema cleanly, so we created simple simulated tournament data as students. The script generated 220 tournaments with basic names like `Student Sim Tournament 1`, rotating locations from a small list, and generated dates across 2023 to 2026. For each tournament, it selected a set of unique players and then assigned straightforward random values for `GamesPlayed`, `GamesWon`, and `RatingChange` using a seeded pseudo-random generator.

To support the rating-growth query, the script also generated simple historical standard-rating snapshots for 2020 through 2025. These yearly standard ratings are not from an external tournament dataset; they are naive simulated values derived from each player's available standard rating so that the database has multiple years to compare. The goal was not to build a sophisticated simulation, but to produce consistent sample data that fits the schema and satisfies the project requirements.

## Advanced Queries And Indexing

## Q1. Win rate percentage by country

This query summarizes how countries perform overall in tournament participation by comparing total wins against total games played. This query uses join, group by.

```sql
SELECT
  p.Country,
  COUNT(*) AS total_participations,
  SUM(tr.GamesWon) AS total_wins,
  SUM(tr.GamesPlayed) AS total_games,
  SUM(tr.GamesWon) / SUM(tr.GamesPlayed) AS win_rate
FROM Players p
JOIN TournamentResults tr
  ON p.player_ID = tr.player_ID
WHERE tr.GamesPlayed > 1
GROUP BY p.Country
ORDER BY win_rate DESC
LIMIT 15;
```

Top 15 rows:

| Country | total_participations | total_wins | total_games | win_rate |
| --- | --- | --- | --- | --- |
| LES | 1 | 10 | 10 | 1.0000 |
| MAC | 1 | 8 | 8 | 1.0000 |
| ANG | 1 | 10 | 10 | 1.0000 |
| SUR | 1 | 10 | 11 | 0.9091 |
| GUA | 1 | 9 | 10 | 0.9000 |
| QAT | 3 | 24 | 28 | 0.8571 |
| POR | 3 | 27 | 32 | 0.8438 |
| VIE | 3 | 23 | 29 | 0.7931 |
| TJK | 5 | 39 | 51 | 0.7647 |
| IRL | 3 | 24 | 32 | 0.7500 |
| SVK | 2 | 17 | 23 | 0.7391 |
| LBR | 2 | 15 | 21 | 0.7143 |
| HUN | 5 | 35 | 51 | 0.6863 |
| CHN | 2 | 13 | 19 | 0.6842 |
| ARM | 11 | 80 | 118 | 0.6780 |

Screenshot of top 15 rows:

![Win rate percentage by country result screenshot](screenshots/q1-results.svg)

Index designs and EXPLAIN ANALYZE cost summary:

| Design | Cost | Notes |
| --- | ---: | --- |
| baseline | 1244 | Use only the default primary-key indexes. |
| results_games_filter | 2579 | Add an index on `GamesPlayed` and `GamesWon`, both non-primary-key columns used in the query, so MySQL can narrow qualifying tournament rows earlier. |
| country_only | 1244 | Add an index on `Country`, the grouped non-primary-key attribute from `Players`, to test whether grouping support helps more than filtering support. |
| results_plus_country | 2579 | Combine the non-primary-key results index with the non-primary-key country index to support both filtering and grouping without indexing any primary-key columns. |

For win rate percentage by country, I compared the baseline plan against three non-default indexing designs. I selected `baseline` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design decreased from 1244 to 1244. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.

The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.

Selected final design: `baseline`

EXPLAIN ANALYZE screenshot:

![Win rate percentage by country EXPLAIN ANALYZE screenshot](screenshots/q1-explain.svg)

EXPLAIN ANALYZE outputs:

### Q1 - baseline

```text
-> Limit: 15 row(s)  (actual time=12.4..12.4 rows=15 loops=1)
    -> Sort: win_rate DESC, limit input to 15 row(s) per chunk  (actual time=12.4..12.4 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=12.4..12.4 rows=123 loops=1)
            -> Aggregate using temporary table  (actual time=12.4..12.4 rows=123 loops=1)
                -> Nested loop inner join  (cost=1244 rows=1906) (actual time=0.13..7.28 rows=5720 loops=1)
                    -> Filter: (tr.GamesPlayed > 1)  (cost=577 rows=1906) (actual time=0.12..1.73 rows=5720 loops=1)
                        -> Table scan on tr  (cost=577 rows=5720) (actual time=0.119..1.38 rows=5720 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=818e-6..838e-6 rows=1 loops=5720)

```

### Q1 - results_games_filter

```text
-> Limit: 15 row(s)  (actual time=15.3..15.3 rows=15 loops=1)
    -> Sort: win_rate DESC, limit input to 15 row(s) per chunk  (actual time=15.3..15.3 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=15.3..15.3 rows=123 loops=1)
            -> Aggregate using temporary table  (actual time=15.3..15.3 rows=123 loops=1)
                -> Nested loop inner join  (cost=2579 rows=5720) (actual time=0.084..9.85 rows=5720 loops=1)
                    -> Filter: (tr.GamesPlayed > 1)  (cost=577 rows=5720) (actual time=0.0759..1.62 rows=5720 loops=1)
                        -> Covering index scan on tr using idx_results_gamesplayed_gameswon  (cost=577 rows=5720) (actual time=0.075..1.25 rows=5720 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00129..0.00131 rows=1 loops=5720)

```

### Q1 - country_only

```text
-> Limit: 15 row(s)  (actual time=12.2..12.2 rows=15 loops=1)
    -> Sort: win_rate DESC, limit input to 15 row(s) per chunk  (actual time=12.2..12.2 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=12.1..12.1 rows=123 loops=1)
            -> Aggregate using temporary table  (actual time=12.1..12.1 rows=123 loops=1)
                -> Nested loop inner join  (cost=1244 rows=1906) (actual time=0.0909..7.15 rows=5720 loops=1)
                    -> Filter: (tr.GamesPlayed > 1)  (cost=577 rows=1906) (actual time=0.0826..1.72 rows=5720 loops=1)
                        -> Table scan on tr  (cost=577 rows=5720) (actual time=0.0819..1.37 rows=5720 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=794e-6..814e-6 rows=1 loops=5720)

```

### Q1 - results_plus_country

```text
-> Limit: 15 row(s)  (actual time=15.6..15.6 rows=15 loops=1)
    -> Sort: win_rate DESC, limit input to 15 row(s) per chunk  (actual time=15.6..15.6 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=15.5..15.6 rows=123 loops=1)
            -> Aggregate using temporary table  (actual time=15.5..15.5 rows=123 loops=1)
                -> Nested loop inner join  (cost=2579 rows=5720) (actual time=0.1..10.1 rows=5720 loops=1)
                    -> Filter: (tr.GamesPlayed > 1)  (cost=577 rows=5720) (actual time=0.0926..1.69 rows=5720 loops=1)
                        -> Covering index scan on tr using idx_results_gamesplayed_gameswon  (cost=577 rows=5720) (actual time=0.0913..1.29 rows=5720 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00131..0.00134 rows=1 loops=5720)

```

## Q2. Players with the most wins

This query lists players with the highest total win counts across all tournament participation records. This query uses join, group by, having.

```sql
SELECT
  p.player_ID,
  p.Name,
  COUNT(*) AS tournaments_played,
  SUM(tr.GamesWon) AS total_wins,
  SUM(tr.GamesPlayed) AS total_games
FROM Players p
JOIN TournamentResults tr
  ON p.player_ID = tr.player_ID
GROUP BY p.player_ID, p.Name
HAVING SUM(tr.GamesPlayed) > 0
ORDER BY total_wins DESC
LIMIT 15;
```

Top 15 rows:

| player_ID | Name | tournaments_played | total_wins | total_games |
| --- | --- | --- | --- | --- |
| 54270952 | Abdelhadi Mohamed, Ahmed | 6 | 50 | 68 |
| 35897287 | Abd Rasih, Radzi | 6 | 43 | 64 |
| 33419760 | Aarav Nareda | 4 | 38 | 43 |
| 10668080 | Abdel Razik Abdel Rahman, Mohamed | 4 | 36 | 44 |
| 13403818 | Abdullayev, Shami | 4 | 36 | 43 |
| 558002367 | Aaditha Pavan Shastry | 5 | 36 | 54 |
| 4800176 | Abdulla, A. | 6 | 35 | 62 |
| 25677853 | Abdul Kalam | 4 | 35 | 42 |
| 7839090 | Abdullah Ahmad Yahya | 5 | 34 | 51 |
| 9041516 | Abdelali, Assia | 4 | 34 | 46 |
| 45077959 | Aarush Gupta | 5 | 34 | 45 |
| 564028151 | Abdul Khalik Vohra | 4 | 34 | 41 |
| 10696083 | Abdel Hakam, Yahia | 6 | 33 | 56 |
| 1505300 | Aarstad, Tron | 4 | 32 | 40 |
| 10615156 | Abdel Nour, Malak | 4 | 32 | 39 |

Screenshot of top 15 rows:

![Players with the most wins result screenshot](screenshots/q2-results.svg)

Index designs and EXPLAIN ANALYZE cost summary:

| Design | Cost | Notes |
| --- | ---: | --- |
| baseline | 2579 | Use only the default primary-key indexes. |
| results_wins_games | 2579 | Add an index on `GamesWon` and `GamesPlayed`, which are the non-primary-key tournament-result columns used in the aggregates and HAVING condition. |
| name_only | 2579 | Add an index on `Name`, the non-primary-key player attribute used in the grouped output, to compare against the results-table-only design. |
| results_plus_name | 2579 | Combine the non-primary-key results index with the non-primary-key player-name index to support both aggregation and grouped output columns. |

For players with the most wins, I compared the baseline plan against three non-default indexing designs. I selected `baseline` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design decreased from 2579 to 2579. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.

The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.

Selected final design: `baseline`

EXPLAIN ANALYZE screenshot:

![Players with the most wins EXPLAIN ANALYZE screenshot](screenshots/q2-explain.svg)

EXPLAIN ANALYZE outputs:

### Q2 - baseline

```text
-> Limit: 15 row(s)  (actual time=13.6..13.6 rows=15 loops=1)
    -> Sort: total_wins DESC  (actual time=13.6..13.6 rows=15 loops=1)
        -> Filter: (`sum(tr.GamesPlayed)` > 0)  (actual time=11.5..12.2 rows=3397 loops=1)
            -> Table scan on <temporary>  (actual time=11.5..11.9 rows=3397 loops=1)
                -> Aggregate using temporary table  (actual time=11.5..11.5 rows=3397 loops=1)
                    -> Nested loop inner join  (cost=2579 rows=5720) (actual time=0.147..6.61 rows=5720 loops=1)
                        -> Table scan on tr  (cost=577 rows=5720) (actual time=0.137..1.38 rows=5720 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=778e-6..799e-6 rows=1 loops=5720)

```

### Q2 - results_wins_games

```text
-> Limit: 15 row(s)  (actual time=16.6..16.6 rows=15 loops=1)
    -> Sort: total_wins DESC  (actual time=16.6..16.6 rows=15 loops=1)
        -> Filter: (`sum(tr.GamesPlayed)` > 0)  (actual time=14.5..15.3 rows=3397 loops=1)
            -> Table scan on <temporary>  (actual time=14.5..15 rows=3397 loops=1)
                -> Aggregate using temporary table  (actual time=14.5..14.5 rows=3397 loops=1)
                    -> Nested loop inner join  (cost=2579 rows=5720) (actual time=0.125..9.3 rows=5720 loops=1)
                        -> Covering index scan on tr using idx_results_gameswon_gamesplayed  (cost=577 rows=5720) (actual time=0.115..1.3 rows=5720 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00125..0.00127 rows=1 loops=5720)

```

### Q2 - name_only

```text
-> Limit: 15 row(s)  (actual time=13.6..13.6 rows=15 loops=1)
    -> Sort: total_wins DESC  (actual time=13.6..13.6 rows=15 loops=1)
        -> Filter: (`sum(tr.GamesPlayed)` > 0)  (actual time=11.5..12.2 rows=3397 loops=1)
            -> Table scan on <temporary>  (actual time=11.5..11.9 rows=3397 loops=1)
                -> Aggregate using temporary table  (actual time=11.5..11.5 rows=3397 loops=1)
                    -> Nested loop inner join  (cost=2579 rows=5720) (actual time=0.119..6.59 rows=5720 loops=1)
                        -> Table scan on tr  (cost=577 rows=5720) (actual time=0.112..1.34 rows=5720 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=781e-6..801e-6 rows=1 loops=5720)

```

### Q2 - results_plus_name

```text
-> Limit: 15 row(s)  (actual time=17.1..17.1 rows=15 loops=1)
    -> Sort: total_wins DESC  (actual time=17.1..17.1 rows=15 loops=1)
        -> Filter: (`sum(tr.GamesPlayed)` > 0)  (actual time=14.8..15.6 rows=3397 loops=1)
            -> Table scan on <temporary>  (actual time=14.8..15.3 rows=3397 loops=1)
                -> Aggregate using temporary table  (actual time=14.8..14.8 rows=3397 loops=1)
                    -> Nested loop inner join  (cost=2579 rows=5720) (actual time=0.0763..9.35 rows=5720 loops=1)
                        -> Covering index scan on tr using idx_results_gameswon_gamesplayed  (cost=577 rows=5720) (actual time=0.0683..1.26 rows=5720 loops=1)
                        -> Single-row index lookup on p using PRIMARY (player_ID=tr.player_ID)  (cost=0.25 rows=1) (actual time=0.00126..0.00129 rows=1 loops=5720)

```

## Q3. Players with the highest standard rating growth from 2020 to 2025

This query measures how much each player's standard rating changed between the available rating snapshots from 2020 through 2025. This query uses join, group by.

```sql
SELECT
  p.player_ID,
  p.Name,
  r.Rating_Type,
  MAX(r.Rating) - MIN(r.Rating) AS rating_growth
FROM Players p
JOIN Ratings r
  ON p.player_ID = r.player_ID
WHERE r.Rating_Type = 'standard'
  AND r.RatingDate BETWEEN '2020-01-01' AND '2025-12-31'
GROUP BY p.player_ID, p.Name, r.Rating_Type
ORDER BY rating_growth DESC
LIMIT 15;
```

Top 15 rows:

| player_ID | Name | Rating_Type | rating_growth |
| --- | --- | --- | --- |
| 48781541 | Aayush Palariya | standard | 80 |
| 14206420 | Abdukholikova, Rano | standard | 80 |
| 33429740 | Aarav Sagar Khedu | standard | 79 |
| 12100080 | Abdulla, Ahmed Ibrahim | standard | 79 |
| 14236370 | Abdinabiev, Sarvarbek | standard | 79 |
| 13458604 | Abbassoy, Javad | standard | 79 |
| 10801839 | Abera, Aydagnuhem Gezachew | standard | 79 |
| 1564404 | Aas, Bjornar | standard | 79 |
| 33478198 | Aaryan Baby | standard | 79 |
| 13465830 | Abdullayev, Rasul | standard | 78 |
| 9302492 | Abdulaziz, Eman | standard | 78 |
| 35076388 | Abel, Saju Chazhoor | standard | 78 |
| 42583233 | Abadi, Mahta | standard | 78 |
| 8116520 | Abdel Rauof Alhajjaj | standard | 78 |
| 1590839 | Abbas, Yousf Layth | standard | 78 |

Screenshot of top 15 rows:

![Players with the highest standard rating growth from 2020 to 2025 result screenshot](screenshots/q3-results.svg)

Index designs and EXPLAIN ANALYZE cost summary:

| Design | Cost | Notes |
| --- | ---: | --- |
| baseline | 3273 | Use only the default primary-key indexes. |
| rating_only | 3273 | Add an index on `Rating`, the main non-primary-key attribute used in the MAX/MIN calculation for rating growth. |
| name_only | 3273 | Add an index on `Name`, the non-primary-key player attribute used in the grouped output, to see whether it helps the join and grouping stage. |
| rating_plus_name | 3273 | Combine the non-primary-key rating index with the non-primary-key player-name index so the design still avoids all primary-key columns. |

For players with the highest standard rating growth from 2020 to 2025, I compared the baseline plan against three non-default indexing designs. I selected `baseline` because it produced the lowest reported cost for this query. Relative to the baseline, the chosen design decreased from 3273 to 3273. This result matches the query shape: the selected indexes cover the most selective filters and/or join attributes that appear in the WHERE, GROUP BY, or HAVING clauses.

The alternative designs still matter because they show the tradeoff space required by the assignment. Some designs only help one stage of the query plan, while others add indexes that are broader but less selective. When a design does not improve the reported cost very much, that likely means the dataset is moderate in size, the optimizer still prefers scans or temporary aggregation, or the predicate selectivity is not strong enough for the extra index to change the plan substantially.

Selected final design: `baseline`

EXPLAIN ANALYZE screenshot:

![Players with the highest standard rating growth from 2020 to 2025 EXPLAIN ANALYZE screenshot](screenshots/q3-explain.svg)

EXPLAIN ANALYZE outputs:

### Q3 - baseline

```text
-> Limit: 15 row(s)  (actual time=37.8..37.8 rows=15 loops=1)
    -> Sort: rating_growth DESC, limit input to 15 row(s) per chunk  (actual time=37.8..37.8 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=37..37.5 rows=3176 loops=1)
            -> Aggregate using temporary table  (actual time=37..37 rows=3176 loops=1)
                -> Nested loop inner join  (cost=3273 rows=344) (actual time=0.38..24.3 rows=19056 loops=1)
                    -> Filter: ((r.Rating_Type = 'standard') and (r.RatingDate between '2020-01-01' and '2025-12-31'))  (cost=3152 rows=344) (actual time=0.369..15.6 rows=19056 loops=1)
                        -> Table scan on r  (cost=3152 rows=30959) (actual time=0.363..6.59 rows=27645 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=298e-6..319e-6 rows=1 loops=19056)

```

### Q3 - rating_only

```text
-> Limit: 15 row(s)  (actual time=57.5..57.5 rows=15 loops=1)
    -> Sort: rating_growth DESC, limit input to 15 row(s) per chunk  (actual time=57.5..57.5 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=56.7..57.2 rows=3176 loops=1)
            -> Aggregate using temporary table  (actual time=56.7..56.7 rows=3176 loops=1)
                -> Nested loop inner join  (cost=3273 rows=344) (actual time=0.352..42.5 rows=19056 loops=1)
                    -> Filter: ((r.Rating_Type = 'standard') and (r.RatingDate between '2020-01-01' and '2025-12-31'))  (cost=3152 rows=344) (actual time=0.34..15.3 rows=19056 loops=1)
                        -> Covering index scan on r using idx_ratings_rating_only  (cost=3152 rows=30959) (actual time=0.334..5.83 rows=27645 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=0.00125..0.00127 rows=1 loops=19056)

```

### Q3 - name_only

```text
-> Limit: 15 row(s)  (actual time=37.2..37.2 rows=15 loops=1)
    -> Sort: rating_growth DESC, limit input to 15 row(s) per chunk  (actual time=37.2..37.2 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=36.4..36.8 rows=3176 loops=1)
            -> Aggregate using temporary table  (actual time=36.4..36.4 rows=3176 loops=1)
                -> Nested loop inner join  (cost=3273 rows=344) (actual time=0.374..23.7 rows=19056 loops=1)
                    -> Filter: ((r.Rating_Type = 'standard') and (r.RatingDate between '2020-01-01' and '2025-12-31'))  (cost=3152 rows=344) (actual time=0.365..15.3 rows=19056 loops=1)
                        -> Table scan on r  (cost=3152 rows=30959) (actual time=0.36..6.48 rows=27645 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=288e-6..308e-6 rows=1 loops=19056)

```

### Q3 - rating_plus_name

```text
-> Limit: 15 row(s)  (actual time=58..58 rows=15 loops=1)
    -> Sort: rating_growth DESC, limit input to 15 row(s) per chunk  (actual time=58..58 rows=15 loops=1)
        -> Table scan on <temporary>  (actual time=57.2..57.7 rows=3176 loops=1)
            -> Aggregate using temporary table  (actual time=57.2..57.2 rows=3176 loops=1)
                -> Nested loop inner join  (cost=3273 rows=344) (actual time=0.297..42.6 rows=19056 loops=1)
                    -> Filter: ((r.Rating_Type = 'standard') and (r.RatingDate between '2020-01-01' and '2025-12-31'))  (cost=3152 rows=344) (actual time=0.288..15.4 rows=19056 loops=1)
                        -> Covering index scan on r using idx_ratings_rating_only  (cost=3152 rows=30959) (actual time=0.282..5.92 rows=27645 loops=1)
                    -> Single-row index lookup on p using PRIMARY (player_ID=r.player_ID)  (cost=0.25 rows=1) (actual time=0.00127..0.00129 rows=1 loops=19056)

```
