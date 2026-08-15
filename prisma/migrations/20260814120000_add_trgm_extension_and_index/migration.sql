DROP INDEX IF EXISTS "Log_message_trgm_idx";
DROP INDEX IF EXISTS "Log_service_timestamp_idx";
DROP INDEX IF EXISTS "Log_level_timestamp_idx";
DROP INDEX IF EXISTS "Log_timestamp_service_idx";
DROP INDEX IF EXISTS "Log_timestamp_level_idx";

CREATE EXTENSION IF NOT EXISTS pg_trgm;
