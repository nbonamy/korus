-- Parameters: inclusive from/to UTC dates, nullable canonical provider/model.
-- All counts/decimals are text to preserve exact PostgreSQL sums in JSON.
-- One statement means all sections observe the same committed snapshot.
WITH bounds AS (
 SELECT $1::date AS lo, $2::date AS hi
), days AS (
 SELECT d::date AS day FROM bounds, generate_series(lo::timestamp,hi::timestamp,interval '1 day') d
), filtered AS (
 SELECT u.* FROM usage_daily u, bounds
 WHERE u.day BETWEEN lo AND hi AND ($3::text IS NULL OR provider=$3)
 AND ($4::text IS NULL OR model=$4)
), keys AS (
 SELECT 'daily' AS kind, day AS bucket, NULL::text AS provider, NULL::text AS model FROM days
 UNION ALL SELECT DISTINCT 'weekly',date_trunc('week',day::timestamp)::date,NULL,NULL FROM days
 UNION ALL SELECT DISTINCT 'model',NULL::date,provider,model FROM filtered
 UNION ALL SELECT 'total',NULL::date,NULL::text,NULL::text
), expanded AS (
 -- Four copies per observed group, plus empty bucket sentinels. Avoid a
 -- range-days x usage-rows join when querying years of retained history.
 SELECT k.kind,k.bucket,k.provider AS group_provider,k.model AS group_model,
 NULL::uuid AS install_id,NULL::bigint AS turns,NULL::bigint AS input_tokens,
 NULL::bigint AS cached_input_tokens,NULL::bigint AS output_tokens,NULL::numeric AS estimated_cost_usd
 FROM keys k
 UNION ALL
 SELECT k.kind,k.bucket,k.provider,k.model,u.install_id,u.turns,u.input_tokens,
 u.cached_input_tokens,u.output_tokens,u.estimated_cost_usd
 FROM filtered u CROSS JOIN LATERAL (VALUES
 ('daily',u.day,NULL::text,NULL::text),
 ('weekly',date_trunc('week',u.day::timestamp)::date,NULL::text,NULL::text),
 ('model',NULL::date,u.provider,u.model),
 ('total',NULL::date,NULL::text,NULL::text)
 ) k(kind,bucket,provider,model)
), stats AS (
 SELECT u.kind,u.bucket,u.group_provider AS provider,u.group_model AS model,
 count(u.install_id) AS groups,coalesce(sum(u.turns),0) AS turns,
 sum(u.input_tokens) AS input_tokens,
 count(u.install_id) FILTER (WHERE u.input_tokens IS NULL) AS unknown_input,
 sum(u.cached_input_tokens) AS cached_input_tokens,
 count(u.install_id) FILTER (WHERE u.cached_input_tokens IS NULL) AS unknown_cached,
 sum(u.output_tokens) AS output_tokens,
 count(u.install_id) FILTER (WHERE u.output_tokens IS NULL) AS unknown_output,
 sum(u.input_tokens::numeric+u.output_tokens) AS total_tokens,
 count(u.install_id) FILTER (WHERE u.input_tokens IS NULL OR u.output_tokens IS NULL) AS excluded_tokens,
 sum(u.input_tokens) FILTER (WHERE u.cached_input_tokens IS NOT NULL) AS cache_input,
 sum(u.cached_input_tokens) FILTER (WHERE u.input_tokens IS NOT NULL) AS cache_read,
 sum(u.input_tokens::numeric-u.cached_input_tokens) AS non_cache_read,
 sum(u.estimated_cost_usd) AS cost,
 count(u.install_id) FILTER (WHERE u.estimated_cost_usd IS NULL) AS unknown_cost,
 count(u.install_id) FILTER (WHERE u.input_tokens IS NULL OR u.cached_input_tokens IS NULL) AS excluded_cache
 FROM expanded u
 GROUP BY u.kind,u.bucket,u.group_provider,u.group_model
), summaries AS (
 SELECT kind,bucket,provider,model,jsonb_build_object(
 'groups',groups::text,'turns',turns::text,
 'inputTokens',input_tokens::text,'unknownInputGroups',unknown_input::text,
 'cachedInputTokens',cached_input_tokens::text,'unknownCachedInputGroups',unknown_cached::text,
 'outputTokens',output_tokens::text,'unknownOutputGroups',unknown_output::text,
 'totalTokens',total_tokens::text,'excludedTokenGroups',excluded_tokens::text,
 'cacheInputTokens',cache_input::text,'cacheReadTokens',cache_read::text,
 'nonCacheReadTokens',non_cache_read::text,
 'cacheReadShare',(cache_read/nullif(cache_input,0))::double precision,
 'excludedCacheGroups',excluded_cache::text,
 'estimatedCostUsd',trim_scale(cost)::text,'unknownCostGroups',unknown_cost::text,
 'costCoverage',CASE WHEN groups=0 THEN 'empty' WHEN unknown_cost=groups THEN 'unavailable'
 WHEN unknown_cost>0 THEN 'partial' ELSE 'complete' END
 ) AS value FROM stats s
)
SELECT jsonb_build_object(
 'range',jsonb_build_object('from',$1::text,'to',$2::text,'provider',$3::text,'model',$4::text),
 'availability',(SELECT jsonb_build_object('firstDay',min(day),'lastDay',max(day),'lastReceivedAt',max(received_at)) FROM install_days),
 'overview',(SELECT jsonb_build_object(
 'participatingInstalls',(SELECT count(*)::text FROM installs WHERE first_reported_day<=hi),
 'dau',(SELECT count(*)::text FROM install_days WHERE day=hi),
 'wau',(SELECT count(DISTINCT install_id)::text FROM install_days WHERE day BETWEEN hi-6 AND hi),
 'mau',(SELECT count(DISTINCT install_id)::text FROM install_days WHERE day BETWEEN hi-29 AND hi),
 'calendarMonthActives',(SELECT count(DISTINCT install_id)::text FROM install_days WHERE day BETWEEN date_trunc('month',hi::timestamp)::date AND hi)
 ) FROM bounds),
 'activity',(SELECT jsonb_agg(jsonb_build_object('day',d.day,
 'activeInstalls',(SELECT count(*)::text FROM install_days i WHERE i.day=d.day),
 'firstReportedInstalls',(SELECT count(*)::text FROM installs i WHERE i.first_reported_day=d.day)) ORDER BY d.day) FROM days d),
 'totals',(SELECT value FROM summaries WHERE kind='total'),
 'daily',(SELECT jsonb_agg(value||jsonb_build_object('day',bucket) ORDER BY bucket) FROM summaries WHERE kind='daily'),
 'weekly',(SELECT jsonb_agg(value||jsonb_build_object('week',bucket) ORDER BY bucket) FROM summaries WHERE kind='weekly'),
 'models',coalesce((SELECT jsonb_agg(value||jsonb_build_object('provider',provider,'model',model) ORDER BY provider,model) FROM summaries WHERE kind='model'),'[]'::jsonb)
) AS metrics;
