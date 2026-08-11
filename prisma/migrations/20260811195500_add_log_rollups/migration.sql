CREATE TABLE "LogRollup" (
    "bucket" TIMESTAMP(3) NOT NULL,
    "service" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "count" BIGINT NOT NULL,

    CONSTRAINT "LogRollup_pkey" PRIMARY KEY ("bucket", "service", "level")
);

CREATE INDEX "LogRollup_service_bucket_idx" ON "LogRollup"("service", "bucket");
CREATE INDEX "LogRollup_level_bucket_idx" ON "LogRollup"("level", "bucket");

INSERT INTO "LogRollup" ("bucket", "service", "level", "count")
SELECT
    date_trunc('minute', "timestamp") AS "bucket",
    "service",
    "level",
    COUNT(*)::BIGINT AS "count"
FROM "Log"
GROUP BY 1, 2, 3;
