-- DropIndex
DROP INDEX "Log_level_idx";

-- DropIndex
DROP INDEX "Log_service_idx";

-- CreateIndex
CREATE INDEX "Log_service_timestamp_idx" ON "Log"("service", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Log_level_timestamp_idx" ON "Log"("level", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Log_attributes_idx" ON "Log" USING GIN ("attributes");
