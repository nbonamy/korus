-- Parameters: inclusive viewer dates, nullable canonical provider/model, boolean combine-service-tiers, IANA timezone.
-- All counts/decimals are text to preserve exact PostgreSQL sums in JSON.
-- One statement means all sections observe the same committed snapshot.
WITH bounds AS (
 SELECT $1::date AS lo, $2::date AS hi
), days AS (
 SELECT d::date AS day FROM bounds, generate_series(lo::timestamp,hi::timestamp,interval '1 day') d
), local_activity AS (
 SELECT i.install_id,
 CASE WHEN h IS NULL THEN i.day ELSE
 ((i.day::timestamp + h * interval '1 hour') AT TIME ZONE 'UTC' AT TIME ZONE $6::text)::date END AS day,
 max(i.received_at) AS received_at
 FROM install_days i LEFT JOIN LATERAL unnest(i.reported_hours) h ON true
 GROUP BY i.install_id,2
), local_installs AS (
 SELECT install_id,CASE WHEN first_reported_hour IS NULL THEN first_reported_day ELSE
 ((first_reported_day::timestamp + first_reported_hour * interval '1 hour') AT TIME ZONE 'UTC' AT TIME ZONE $6::text)::date END AS first_reported_day
 FROM installs
), local_usage AS (
 SELECT u.*,CASE WHEN report_hour=-1 THEN day ELSE
 ((day::timestamp + report_hour * interval '1 hour') AT TIME ZONE 'UTC' AT TIME ZONE $6::text)::date END AS local_day
 FROM usage_daily u,bounds WHERE day BETWEEN lo-1 AND hi+1
), daily_usage AS (
 SELECT install_id,local_day AS day,provider,model,service_tier,
 sum(turns)::bigint AS turns,
 sum(input_tokens)::bigint AS input_tokens,
 sum(cached_input_tokens)::bigint AS cached_input_tokens,
 sum(output_tokens)::bigint AS output_tokens,
 sum(estimated_cost_usd) AS estimated_cost_usd,
 sum(input_tokens) FILTER (WHERE output_tokens IS NOT NULL) AS paired_input,
 sum(output_tokens) FILTER (WHERE input_tokens IS NOT NULL) AS paired_output,
 sum(input_tokens) FILTER (WHERE cached_input_tokens IS NOT NULL) AS cache_input,
 sum(cached_input_tokens) FILTER (WHERE input_tokens IS NOT NULL) AS cache_read,
 sum(input_tokens::numeric-cached_input_tokens) AS non_cache_read,
 sum(coalesce(measured_turns,CASE WHEN input_tokens IS NOT NULL AND cached_input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN turns ELSE 0 END))::bigint AS measured_turns,
 bool_or(coalesce(cost_coverage,CASE WHEN estimated_cost_usd IS NULL THEN 'unavailable' ELSE 'complete' END)<>'complete') AS cost_incomplete,
 sum(speed_turns)::bigint AS speed_turns,sum(speed_output_tokens)::bigint AS speed_output_tokens,
 sum(generation_ms)::bigint AS generation_ms,sum(ttft_ms)::bigint AS ttft_ms,sum(ttft_turns)::bigint AS ttft_turns
 FROM local_usage, bounds WHERE local_day BETWEEN lo AND hi
 GROUP BY install_id,local_day,provider,model,service_tier
), filtered AS (
 SELECT u.*, CASE WHEN $5::boolean THEN NULL::text ELSE u.service_tier END AS tier FROM daily_usage u, bounds
 WHERE u.day BETWEEN lo AND hi AND ($3::text IS NULL OR provider=$3)
 AND ($4::text IS NULL OR model=$4)
), weekly_users AS (
 SELECT install_id,sum(turns) AS turns,
 sum(coalesce(input_tokens::numeric,0)+coalesce(output_tokens,0))
   FILTER (WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL) AS total_tokens,
 sum(estimated_cost_usd) AS cost
 FROM filtered,bounds WHERE day>=hi-6
 GROUP BY install_id HAVING sum(turns)>0
), weekly_leaders AS (
 SELECT row_number() OVER (ORDER BY turns DESC,total_tokens DESC NULLS LAST,cost DESC NULLS LAST,install_id) AS rank,
 turns,total_tokens,cost,
 round(turns/nullif(sum(turns) OVER (),0),6) AS turn_share
 FROM weekly_users
 ORDER BY turns DESC,total_tokens DESC NULLS LAST,cost DESC NULLS LAST,install_id
 LIMIT 10
), keys AS (
 SELECT 'daily' AS kind, day AS bucket, NULL::text AS provider, NULL::text AS model, NULL::text AS tier FROM days
 UNION ALL SELECT DISTINCT 'weekly',date_trunc('week',day::timestamp)::date,NULL,NULL,NULL FROM days
 UNION ALL SELECT DISTINCT 'model',NULL::date,provider,model,tier FROM filtered
 UNION ALL SELECT DISTINCT 'modelDaily',day,provider,model,tier FROM filtered
 UNION ALL SELECT 'total',NULL::date,NULL::text,NULL::text,NULL::text
), expanded AS (
 -- Five copies per observed group, plus empty bucket sentinels. Avoid a
 -- range-days x usage-rows join when querying years of retained history.
 SELECT k.kind,k.bucket,k.provider AS group_provider,k.model AS group_model,k.tier AS group_tier,
 NULL::uuid AS install_id,NULL::bigint AS turns,NULL::bigint AS input_tokens,
 NULL::bigint AS cached_input_tokens,NULL::bigint AS output_tokens,NULL::numeric AS estimated_cost_usd,
 NULL::bigint AS measured_turns,NULL::boolean AS cost_incomplete,
 NULL::numeric AS paired_input,NULL::numeric AS paired_output,
 NULL::numeric AS cache_input,NULL::numeric AS cache_read,NULL::numeric AS non_cache_read,
 NULL::bigint AS speed_turns,NULL::bigint AS speed_output_tokens,NULL::bigint AS generation_ms,NULL::bigint AS ttft_ms,NULL::bigint AS ttft_turns
 FROM keys k
 UNION ALL
 SELECT k.kind,k.bucket,k.provider,k.model,k.tier,u.install_id,u.turns,u.input_tokens,
 u.cached_input_tokens,u.output_tokens,u.estimated_cost_usd,u.measured_turns,u.cost_incomplete,u.paired_input,u.paired_output,u.cache_input,u.cache_read,u.non_cache_read,
 u.speed_turns,u.speed_output_tokens,u.generation_ms,u.ttft_ms,u.ttft_turns
 FROM filtered u CROSS JOIN LATERAL (VALUES
 ('daily',u.day,NULL::text,NULL::text,NULL::text),
 ('weekly',date_trunc('week',u.day::timestamp)::date,NULL::text,NULL::text,NULL::text),
 ('model',NULL::date,u.provider,u.model,u.tier),
 ('modelDaily',u.day,u.provider,u.model,u.tier),
 ('total',NULL::date,NULL::text,NULL::text,NULL::text)
 ) k(kind,bucket,provider,model,tier)
), stats AS (
 SELECT u.kind,u.bucket,u.group_provider AS provider,u.group_model AS model,u.group_tier AS tier,
 count(u.install_id) AS groups,coalesce(sum(u.turns),0) AS turns,
 coalesce(sum(u.measured_turns),0) AS measured_turns,coalesce(sum(u.turns-u.measured_turns),0) AS unmeasured_turns,
 coalesce(sum(u.speed_turns),0) AS speed_turns, coalesce(sum(u.ttft_turns),0) AS ttft_turns,
 round(1000*sum(u.speed_output_tokens)::numeric/nullif(sum(u.generation_ms),0),6) AS output_speed,
 round(sum(u.ttft_ms)::numeric/nullif(sum(u.ttft_turns),0),3) AS ttft_average,
 sum(u.input_tokens) AS input_tokens,
 count(u.install_id) FILTER (WHERE u.input_tokens IS NULL) AS unknown_input,
 sum(u.cached_input_tokens) AS cached_input_tokens,
 count(u.install_id) FILTER (WHERE u.cached_input_tokens IS NULL) AS unknown_cached,
 sum(u.output_tokens) AS output_tokens,
 count(u.install_id) FILTER (WHERE u.output_tokens IS NULL) AS unknown_output,
 sum(coalesce(u.input_tokens::numeric,0)+coalesce(u.output_tokens,0)) FILTER (WHERE u.input_tokens IS NOT NULL OR u.output_tokens IS NOT NULL) AS total_tokens,
 sum(u.paired_input) AS paired_input,
 sum(u.paired_output) AS paired_output,
 count(u.install_id) FILTER (WHERE u.input_tokens IS NULL OR u.output_tokens IS NULL OR u.measured_turns<u.turns) AS excluded_tokens,
 sum(u.cache_input) AS cache_input,
 sum(u.cache_read) AS cache_read,
 sum(u.non_cache_read) AS non_cache_read,
 sum(u.estimated_cost_usd) AS cost,
 count(u.install_id) FILTER (WHERE u.cost_incomplete) AS unknown_cost,
 count(u.install_id) FILTER (WHERE u.input_tokens IS NULL OR u.cached_input_tokens IS NULL OR u.measured_turns<u.turns) AS excluded_cache
 FROM expanded u
 GROUP BY u.kind,u.bucket,u.group_provider,u.group_model,u.group_tier
), summaries AS (
 SELECT kind,bucket,provider,model,tier,jsonb_build_object(
 'groups',groups::text,'turns',turns::text,
 'measuredTurns',measured_turns::text,'unmeasuredTurns',unmeasured_turns::text,
 'performance',jsonb_build_object('outputTokensPerSecond',trim_scale(output_speed)::text,
 'timeToFirstOutputMs',trim_scale(ttft_average)::text,'speedTurns',speed_turns::text,'ttftTurns',ttft_turns::text),
 'inputTokens',input_tokens::text,'unknownInputGroups',unknown_input::text,
 'cachedInputTokens',cached_input_tokens::text,'unknownCachedInputGroups',unknown_cached::text,
 'outputTokens',output_tokens::text,'unknownOutputGroups',unknown_output::text,
 'pairedInputTokens',paired_input::text,'pairedOutputTokens',paired_output::text,
 'totalTokens',total_tokens::text,'excludedTokenGroups',excluded_tokens::text,
 'cacheInputTokens',cache_input::text,'cacheReadTokens',cache_read::text,
 'nonCacheReadTokens',non_cache_read::text,
 'cacheReadShare',(cache_read/nullif(cache_input,0))::double precision,
 'excludedCacheGroups',excluded_cache::text,
 'estimatedCostUsd',trim_scale(cost)::text,'unknownCostGroups',unknown_cost::text,
 'costCoverage',CASE WHEN groups=0 THEN 'empty' WHEN cost IS NULL THEN 'unavailable'
 WHEN unknown_cost>0 THEN 'partial' ELSE 'complete' END
 ) AS value FROM stats s
)
SELECT jsonb_build_object(
 'availableProviders',coalesce((SELECT jsonb_agg(provider ORDER BY provider) FROM (
   SELECT DISTINCT provider FROM daily_usage
 ) options),'[]'::jsonb),
 'availableModels',coalesce((SELECT jsonb_agg(model ORDER BY model) FROM (
   SELECT DISTINCT model FROM daily_usage
   WHERE ($3::text IS NULL OR provider=$3) AND (turns>0 OR coalesce(input_tokens,0)>0
     OR coalesce(cached_input_tokens,0)>0 OR coalesce(output_tokens,0)>0
     OR coalesce(estimated_cost_usd,0)>0 OR coalesce(ttft_turns,0)>0)
 ) options),'[]'::jsonb),
 'range',jsonb_build_object('from',$1::text,'to',$2::text,'provider',$3::text,'model',$4::text,'groupServiceTiers',$5::boolean,'timeZone',$6::text),
 'availability',(SELECT jsonb_build_object('firstDay',min(day),'lastDay',max(day),'lastReceivedAt',max(received_at)) FROM local_activity),
 'overview',(SELECT jsonb_build_object(
 'participatingInstalls',(SELECT count(*)::text FROM local_installs WHERE first_reported_day<=hi),
 'dau',(SELECT count(*)::text FROM local_activity WHERE day=hi),
 'wau',(SELECT count(DISTINCT install_id)::text FROM local_activity WHERE day BETWEEN hi-6 AND hi),
 'mau',(SELECT count(DISTINCT install_id)::text FROM local_activity WHERE day BETWEEN hi-29 AND hi),
 'calendarMonthActives',(SELECT count(DISTINCT install_id)::text FROM local_activity WHERE day BETWEEN date_trunc('month',hi::timestamp)::date AND hi)
 ) FROM bounds),
 'activity',(SELECT jsonb_agg(jsonb_build_object('day',d.day,
 'activeInstalls',(SELECT count(*)::text FROM local_activity i WHERE i.day=d.day),
 'firstReportedInstalls',(SELECT count(*)::text FROM local_installs i WHERE i.first_reported_day=d.day)) ORDER BY d.day) FROM days d),
 'weeklyTopUsers',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'rank',rank,'turns',turns::text,'totalTokens',total_tokens::text,
 'estimatedCostUsd',trim_scale(cost)::text,'turnShare',trim_scale(turn_share)::text
 ) ORDER BY rank) FROM weekly_leaders),'[]'::jsonb),
 'totals',(SELECT value FROM summaries WHERE kind='total'),
 'daily',(SELECT jsonb_agg(value||jsonb_build_object('day',bucket) ORDER BY bucket) FROM summaries WHERE kind='daily'),
 'weekly',(SELECT jsonb_agg(value||jsonb_build_object('week',bucket) ORDER BY bucket) FROM summaries WHERE kind='weekly'),
 'modelDaily',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'day',bucket,'provider',provider,'model',model,'serviceTier',tier,
 'estimatedCostUsd',value->'estimatedCostUsd',
 'turns',value->'turns','totalTokens',value->'totalTokens','inputTokens',value->'inputTokens','outputTokens',value->'outputTokens',
 'unknownInputGroups',value->'unknownInputGroups','unknownOutputGroups',value->'unknownOutputGroups',
 'excludedTokenGroups',value->'excludedTokenGroups','measuredTurns',value->'measuredTurns','unmeasuredTurns',value->'unmeasuredTurns','performance',value->'performance'
 ) ORDER BY bucket,provider,model,tier) FROM summaries WHERE kind='modelDaily'),'[]'::jsonb),
 'models',coalesce((SELECT jsonb_agg(value||jsonb_build_object('provider',provider,'model',model,'serviceTier',tier) ORDER BY provider,model,tier) FROM summaries WHERE kind='model'),'[]'::jsonb)
) AS metrics;
