export const VALID_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevelType = (typeof VALID_LEVELS)[number];

export type QueryParams = Record<string, string | undefined>;

export interface ValidatedLogInput {
  timestamp: string;
  level: LogLevelType;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
}

export type AggregateOptions = {
  since: Date;
  until: Date;
  bucket: string;
  groupBy?: string | undefined;
  service?: string | undefined;
  level?: string | undefined;
  q?: string | undefined;
  attrFilters: Record<string, string>;
};
