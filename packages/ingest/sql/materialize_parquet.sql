INSTALL httpfs;
LOAD httpfs;

COPY (
  SELECT * FROM read_ndjson_auto('normalized/members.ndjson')
) TO 'curated/members.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/roll_calls.ndjson')
) TO 'curated/roll_calls.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/vote_facts.ndjson')
) TO 'curated/vote_facts.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/meetings.ndjson')
) TO 'curated/meetings.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/sources.ndjson')
) TO 'curated/sources.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
