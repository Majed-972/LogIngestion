CREATE INDEX "Log_attributes_path_ops_idx"
ON "Log" USING GIN ("attributes" jsonb_path_ops);
