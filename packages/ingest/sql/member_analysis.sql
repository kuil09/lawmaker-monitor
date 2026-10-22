-- DuckDB 2.0 analytical model. All date joins use official periods or observed dates.
SET threads = 2;
SET memory_limit = '2GB';
CREATE TEMP TABLE analysis_meta AS SELECT * FROM read_json('analysis-input/meta.json', columns={schemaVersion:'INTEGER',generatedAt:'VARCHAR',snapshotId:'VARCHAR'});
CREATE TEMP TABLE analysis_members AS
SELECT * REPLACE (profileRaw::VARIANT AS profileRaw) FROM read_json('analysis-input/members.ndjson', format='newline_delimited', columns={
 personId:'VARCHAR', memberId:'VARCHAR', assemblyNo:'INTEGER', name:'VARCHAR', party:'VARCHAR', district:'VARCHAR',
 proportionalFlag:'BOOLEAN', reelectionLabel:'VARCHAR', committees:'VARCHAR[]', careerClaims:'JSON', sourceUrl:'VARCHAR', detailPath:'VARCHAR', profileRaw:'STRUCT(briefHistory VARCHAR, electedAssembliesLabel VARCHAR)'
});
CREATE TEMP TABLE analysis_events AS
SELECT * FROM read_json('analysis-input/events.ndjson', format='newline_delimited', columns={
 memberId:'VARCHAR', eventId:'VARCHAR', kind:'VARCHAR', label:'VARCHAR', startDate:'DATE', endDate:'DATE', observedAt:'VARCHAR', dateBasis:'VARCHAR', dateLabel:'VARCHAR', sourceUrl:'VARCHAR'
});
CREATE TEMP TABLE analysis_activities AS
SELECT DISTINCT * FROM read_json('analysis-input/activities.ndjson', format='newline_delimited', columns={
 activityId:'VARCHAR', memberId:'VARCHAR', kind:'VARCHAR', date:'DATE', title:'VARCHAR', topic:'VARCHAR', voteCode:'VARCHAR', partyAtVote:'VARCHAR', sourceUrl:'VARCHAR', excerpt:'VARCHAR'
});
CREATE TEMP TABLE analysis_assets AS
SELECT r.memberId, r.reportedAt::DATE AS reportedAt, r.currentAmount, r.deltaAmount, r.valueChangeAmount, coalesce(f.downloadUrl,f.sourceUrl) AS sourceUrl
FROM read_parquet('curated/asset_disclosure_records.parquet') r
JOIN read_parquet('curated/asset_disclosures.parquet') f USING(disclosureFileId)
WHERE r.memberId IS NOT NULL AND r.mappingStatus = 'matched';

CREATE MACRO activity_metrics(id, lo, hi) AS (
 SELECT struct_pack(
   eligibleVotes := count(*) FILTER (WHERE kind='vote'),
   participatedVotes := count(*) FILTER (WHERE kind='vote' AND voteCode IN ('yes','no','abstain')),
   unknownVotes := count(*) FILTER (WHERE kind='vote' AND voteCode='unknown'),
   participationRate := count(*) FILTER (WHERE kind='vote' AND voteCode IN ('yes','no','abstain'))::DOUBLE / nullif(count(*) FILTER (WHERE kind='vote'),0),
   proposals := count(*) FILTER (WHERE kind='proposal'), statements := count(*) FILTER (WHERE kind='statement'))
 FROM analysis_activities a WHERE a.memberId=id AND a.date>=lo AND a.date<hi
);
CREATE TEMP TABLE member_metrics AS SELECT memberId,
 activity_metrics(memberId, DATE '1900-01-01', DATE '9999-12-31') AS metrics FROM analysis_members;
CREATE TEMP TABLE monthly_metrics AS SELECT memberId,strftime(date,'%Y-%m') AS month,
 struct_pack(eligibleVotes:=count(*) FILTER(WHERE kind='vote'),
 participatedVotes:=count(*) FILTER(WHERE kind='vote' AND voteCode IN ('yes','no','abstain')),
 unknownVotes:=count(*) FILTER(WHERE kind='vote' AND voteCode='unknown'),
 participationRate:=count(*) FILTER(WHERE kind='vote' AND voteCode IN ('yes','no','abstain'))::DOUBLE/nullif(count(*) FILTER(WHERE kind='vote'),0),
 proposals:=count(*) FILTER(WHERE kind='proposal'),statements:=count(*) FILTER(WHERE kind='statement')) AS metrics
 FROM analysis_activities GROUP BY memberId,month;
CREATE TEMP TABLE monthly_topics AS SELECT memberId, strftime(date,'%Y-%m') AS month, topic, kind,
 count(*) AS count, min(sourceUrl) AS sourceUrl
 FROM analysis_activities WHERE kind<>'vote' OR voteCode IN ('yes','no','abstain')
 GROUP BY memberId, month, topic, kind;

-- Remove consensus votes before pairwise comparison, and never infer a party from today's roster.
CREATE TEMP TABLE contested_votes AS
 SELECT activityId FROM analysis_activities WHERE kind='vote' AND voteCode IN ('yes','no','abstain')
 GROUP BY activityId HAVING greatest(count(*) FILTER(WHERE voteCode='yes'), count(*) FILTER(WHERE voteCode='no'), count(*) FILTER(WHERE voteCode='abstain'))::DOUBLE/count(*) < 0.95;
CREATE TEMP TABLE coalition_pairs AS
 SELECT a.memberId, b.memberId AS otherId, a.topic,
 count(*) AS sharedVotes, count(*) FILTER(WHERE a.voteCode=b.voteCode) AS sameVotes,
 count(*) FILTER(WHERE a.partyAtVote IS NOT NULL AND b.partyAtVote IS NOT NULL AND a.partyAtVote<>b.partyAtVote) AS crossPartyVotes,
 sameVotes::DOUBLE/sharedVotes AS agreementRate
 FROM analysis_activities a JOIN analysis_activities b ON a.activityId=b.activityId AND a.memberId<>b.memberId
 JOIN contested_votes c ON c.activityId=a.activityId
 WHERE a.kind='vote' AND b.kind='vote' AND a.voteCode IN ('yes','no','abstain') AND b.voteCode IN ('yes','no','abstain')
 AND a.partyAtVote IS NOT NULL AND b.partyAtVote IS NOT NULL AND a.partyAtVote<>b.partyAtVote
 GROUP BY a.memberId,b.memberId,a.topic HAVING sharedVotes>=5 AND crossPartyVotes>0;
CREATE TEMP TABLE peers AS
 SELECT a.memberId,b.memberId AS otherId,len(list_intersect(a.committees,b.committees)) AS sharedCommittees,
 a.proportionalFlag=b.proportionalFlag AS sameElectionType,
 a.reelectionLabel IS NOT NULL AND a.reelectionLabel=b.reelectionLabel AS sameReelectionLabel, mm.metrics,
 row_number() OVER(PARTITION BY a.memberId ORDER BY sharedCommittees DESC, sameReelectionLabel DESC, sameElectionType DESC,b.memberId) AS rank
 FROM analysis_members a JOIN analysis_members b ON a.memberId<>b.memberId JOIN member_metrics mm ON mm.memberId=b.memberId
 WHERE len(list_intersect(a.committees,b.committees))>0;
CREATE TEMP TABLE transitions AS
 SELECT e.memberId,e.eventId,e.label,e.startDate AS date,
 activity_metrics(e.memberId,e.startDate-INTERVAL 90 DAY,e.startDate) AS before,
 activity_metrics(e.memberId,e.startDate,e.startDate+INTERVAL 90 DAY) AS after,
 greatest(0,date_diff('day',greatest(bounds.firstDate,e.startDate-INTERVAL 90 DAY),least(bounds.lastDate+INTERVAL 1 DAY,e.startDate))) AS beforeObservedDays,
 greatest(0,date_diff('day',greatest(bounds.firstDate,e.startDate),least(bounds.lastDate+INTERVAL 1 DAY,e.startDate+INTERVAL 90 DAY))) AS afterObservedDays
 FROM analysis_events e CROSS JOIN (SELECT min(date) AS firstDate,max(date) AS lastDate FROM analysis_activities) bounds
 WHERE e.dateBasis='official_period' AND e.kind IN ('committee','tenure') AND e.startDate<=bounds.lastDate;

COPY (
 SELECT 1 AS schemaVersion, meta.generatedAt,meta.snapshotId, version() AS engineVersion,
 struct_pack(members:=(SELECT count(*) FROM analysis_members),
 careerMembers:=(SELECT count(*) FROM analysis_members WHERE json_array_length(careerClaims)>0),
 datedRoles:=(SELECT count(*) FROM analysis_events WHERE dateBasis='official_period'),
 statements:=(SELECT count(*) FROM analysis_activities WHERE kind='statement'),
 firstActivityDate:=(SELECT min(date)::VARCHAR FROM analysis_activities),lastActivityDate:=(SELECT max(date)::VARCHAR FROM analysis_activities)) AS coverage,
 (SELECT list(struct_pack(personId:=personId,memberId:=memberId,assemblyNo:=assemblyNo,name:=name,party:=party,district:=district,
 proportionalFlag:=proportionalFlag,reelectionLabel:=reelectionLabel,committees:=committees,careerClaims:=careerClaims,sourceUrl:=sourceUrl,detailPath:=detailPath) ORDER BY name,memberId) FROM analysis_members) AS members
 FROM analysis_meta meta
) TO 'exports/member_analysis/index.json' (FORMAT JSON, ARRAY true);

COPY (
 SELECT 1 AS schemaVersion,meta.generatedAt,meta.snapshotId,m.memberId,
 coalesce((SELECT list(struct_pack(eventId:=eventId,kind:=kind,label:=label,startDate:=startDate::VARCHAR,endDate:=endDate::VARCHAR,observedAt:=observedAt,dateBasis:=dateBasis,dateLabel:=dateLabel,sourceUrl:=sourceUrl) ORDER BY startDate,eventId) FROM analysis_events e WHERE e.memberId=m.memberId),[]) AS events,
 coalesce((SELECT list(struct_pack(month:=month,topic:=topic,kind:=kind,count:=count,sourceUrl:=sourceUrl) ORDER BY month,topic,kind) FROM monthly_topics t WHERE t.memberId=m.memberId),[]) AS topics,
 coalesce((SELECT list(struct_pack(date:=date::VARCHAR,kind:=kind,title:=title,topic:=topic,sourceUrl:=sourceUrl,excerpt:=excerpt) ORDER BY date DESC,activityId) FROM (SELECT * FROM analysis_activities a WHERE a.memberId=m.memberId AND (kind<>'vote' OR voteCode IN ('yes','no','abstain')) ORDER BY date DESC,activityId LIMIT 500)),[]) AS evidence,
 mm.metrics,
 coalesce((SELECT list(struct_pack(month:=month,metrics:=metrics) ORDER BY month) FROM monthly_metrics t WHERE t.memberId=m.memberId),[]) AS monthlyMetrics,
 coalesce((SELECT list(struct_pack(memberId:=otherId,sharedCommittees:=sharedCommittees,sameElectionType:=sameElectionType,sameReelectionLabel:=sameReelectionLabel,metrics:=metrics,monthlyMetrics:=coalesce((SELECT list(struct_pack(month:=month,metrics:=metrics) ORDER BY month) FROM monthly_metrics t WHERE t.memberId=p.otherId),[])) ORDER BY rank) FROM peers p WHERE p.memberId=m.memberId AND rank<=8),[]) AS peers,
 coalesce((SELECT list(struct_pack(memberId:=otherId,topic:=topic,sharedVotes:=sharedVotes,sameVotes:=sameVotes,agreementRate:=agreementRate,crossPartyVotes:=crossPartyVotes) ORDER BY topic,agreementRate DESC,sharedVotes DESC,otherId) FROM (SELECT * FROM coalition_pairs c WHERE c.memberId=m.memberId QUALIFY row_number() OVER(PARTITION BY topic ORDER BY agreementRate DESC,sharedVotes DESC,otherId)<=5)),[]) AS coalitions,
 coalesce((SELECT list(struct_pack(eventId:=eventId,label:=label,date:=date::VARCHAR,before:=before,after:=after,beforeObservedDays:=beforeObservedDays,afterObservedDays:=afterObservedDays) ORDER BY date) FROM transitions t WHERE t.memberId=m.memberId),[]) AS transitions,
 coalesce((SELECT list(struct_pack(reportedAt:=reportedAt::VARCHAR,currentAmount:=currentAmount,deltaAmount:=deltaAmount,valueChangeAmount:=valueChangeAmount,sourceUrl:=sourceUrl) ORDER BY reportedAt) FROM analysis_assets a WHERE a.memberId=m.memberId),[]) AS assets
 FROM analysis_members m JOIN member_metrics mm USING(memberId) CROSS JOIN analysis_meta meta
) TO 'analysis-input/details.json' (FORMAT JSON, ARRAY true);

COPY analysis_members TO 'curated/analysis_members.parquet' (FORMAT PARQUET,COMPRESSION ZSTD);
COPY analysis_events TO 'curated/analysis_events.parquet' (FORMAT PARQUET,COMPRESSION ZSTD);
COPY analysis_activities TO 'curated/analysis_activities.parquet' (FORMAT PARQUET,COMPRESSION ZSTD);
COPY monthly_topics TO 'curated/analysis_monthly_topics.parquet' (FORMAT PARQUET,COMPRESSION ZSTD);
