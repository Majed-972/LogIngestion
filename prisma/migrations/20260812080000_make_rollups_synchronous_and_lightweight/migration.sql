WITH pending_rollups AS (
  SELECT
    (element.entry->>'bucket')::timestamp AS "bucket",
    element.entry->>'service' AS "service",
    (element.entry->>'level')::"LogLevel" AS "level",
    (element.entry->>'count')::bigint AS "count"
  FROM "LogRollupQueue"
  CROSS JOIN LATERAL jsonb_array_elements("entries") AS element(entry)
)
INSERT INTO "LogRollup" ("bucket", "service", "level", "count")
SELECT "bucket", "service", "level", SUM("count")::bigint
FROM pending_rollups
GROUP BY "bucket", "service", "level"
ON CONFLICT ("bucket", "service", "level")
DO UPDATE SET "count" = "LogRollup"."count" + EXCLUDED."count";

DROP TABLE "LogRollupQueue";
DROP INDEX "Log_service_timestamp_idx";
DROP INDEX "Log_level_timestamp_idx";
DROP INDEX "LogRollup_service_bucket_idx";
DROP INDEX "LogRollup_level_bucket_idx";
ALTER TABLE "LogRollup" SET UNLOGGED;
