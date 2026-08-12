CREATE UNLOGGED TABLE "LogSecondRollup" (
    "bucket" TIMESTAMP(3) NOT NULL,
    "service" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "count" BIGINT NOT NULL,

    CONSTRAINT "LogSecondRollup_pkey" PRIMARY KEY ("bucket", "service", "level")
);

INSERT INTO "LogSecondRollup" ("bucket", "service", "level", "count")
SELECT
    date_trunc('second', "timestamp") AS "bucket",
    "service",
    "level",
    COUNT(*)::bigint AS "count"
FROM "Log"
GROUP BY 1, 2, 3;
