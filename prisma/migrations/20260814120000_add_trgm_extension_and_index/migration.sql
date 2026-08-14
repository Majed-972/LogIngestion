CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Log_message_trgm_idx"
ON "Log" USING GIN (LOWER(message) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Log_service_timestamp_idx"
ON "Log"("service", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "Log_level_timestamp_idx"
ON "Log"("level", "timestamp" DESC);

CREATE INDEX IF NOT EXISTS "Log_timestamp_service_idx"
ON "Log"("timestamp", "service");

CREATE INDEX IF NOT EXISTS "Log_timestamp_level_idx"
ON "Log"("timestamp", "level");

