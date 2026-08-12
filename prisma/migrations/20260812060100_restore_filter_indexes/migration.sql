CREATE INDEX IF NOT EXISTS "Log_service_timestamp_idx" ON "Log"("service", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "Log_level_timestamp_idx" ON "Log"("level", "timestamp" DESC);
