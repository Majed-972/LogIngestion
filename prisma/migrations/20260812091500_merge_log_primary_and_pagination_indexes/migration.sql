ALTER TABLE "Log" DROP CONSTRAINT IF EXISTS "Log_pkey";
DROP INDEX IF EXISTS "Log_timestamp_id_idx";
DROP INDEX IF EXISTS "Log_timestamp_id_key";

CREATE UNIQUE INDEX "Log_timestamp_id_key" ON "Log"("timestamp", "id");
ALTER TABLE "Log"
  ADD CONSTRAINT "Log_pkey" PRIMARY KEY USING INDEX "Log_timestamp_id_key";
