-- Preserve the pre-2.0 public string timestamp contract; ISO timezone inference changed in 2.0.
COPY (
  SELECT * FROM read_ndjson_auto('normalized/members.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
) TO 'curated/members.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/roll_calls.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
) TO 'curated/roll_calls.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson(
    'normalized/vote_facts.ndjson',
    columns = {
      rollCallId: 'VARCHAR',
      memberId: 'VARCHAR',
      memberName: 'VARCHAR',
      party: 'VARCHAR',
      voteCode: 'VARCHAR',
      publishedAt: 'VARCHAR',
      retrievedAt: 'VARCHAR',
      sourceHash: 'VARCHAR'
    }
  )
) TO 'curated/vote_facts.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * EXCLUDE (__seed)
  FROM read_ndjson_auto('normalized/attendance_facts.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
  WHERE COALESCE(__seed, false) = false
) TO 'curated/attendance_facts.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/meetings.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
) TO 'curated/meetings.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * FROM read_ndjson_auto('normalized/sources.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
) TO 'curated/sources.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * EXCLUDE (__seed)
  FROM read_ndjson_auto('normalized/asset_disclosures.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
  WHERE COALESCE(__seed, false) = false
) TO 'curated/asset_disclosures.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * EXCLUDE (__seed)
  FROM read_ndjson_auto('normalized/asset_disclosure_records.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
  WHERE COALESCE(__seed, false) = false
) TO 'curated/asset_disclosure_records.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * EXCLUDE (__seed)
  FROM read_ndjson_auto('normalized/asset_disclosure_categories.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
  WHERE COALESCE(__seed, false) = false
) TO 'curated/asset_disclosure_categories.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);

COPY (
  SELECT * EXCLUDE (__seed)
  FROM read_ndjson_auto('normalized/asset_disclosure_items.ndjson', timestampformat='%Y-%m-%d %H:%M:%S')
  WHERE COALESCE(__seed, false) = false
) TO 'curated/asset_disclosure_items.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
