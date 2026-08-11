const ISO_8601_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isValidIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_8601_TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
