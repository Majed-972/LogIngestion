CREATE TABLE "LogRollupQueue" (
    "id" BIGSERIAL NOT NULL,
    "entries" JSONB NOT NULL,

    CONSTRAINT "LogRollupQueue_pkey" PRIMARY KEY ("id")
);
