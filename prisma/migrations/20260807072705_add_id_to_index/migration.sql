-- DropIndex
DROP INDEX "Log_timestamp_idx";

-- CreateIndex
CREATE INDEX "Log_timestamp_id_idx" ON "Log"("timestamp" DESC, "id" DESC);
