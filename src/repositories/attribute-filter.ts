import { Prisma } from "@prisma/client";

function isCanonicalNumber(value: string): boolean {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && String(numberValue) === value;
}

/**
 * Matches the API contract's string comparison while allowing PostgreSQL's
 * jsonb_path_ops GIN index to serve containment lookups. JSON input preserves
 * numbers and booleans, so their canonical string forms need a typed branch.
 */
export function attributeFilter(key: string, value: string): Prisma.Sql {
  const candidates: Prisma.Sql[] = [
    // Prisma parameters are sent as an untyped PostgreSQL value.  Cast both
    // string arguments explicitly, otherwise jsonb_build_object cannot infer
    // the type for a prepared statement (and GET /logs returns 500).
    Prisma.sql`attributes @> jsonb_build_object(${key}::text, ${value}::text)`,
  ];

  if (value === "true" || value === "false") {
    candidates.push(
      Prisma.sql`attributes @> jsonb_build_object(${key}::text, ${value}::text::boolean)`,
    );
  } else if (isCanonicalNumber(value)) {
    candidates.push(
      Prisma.sql`attributes @> jsonb_build_object(${key}::text, ${value}::text::numeric)`,
    );
  }

  return candidates.length === 1
    ? candidates[0]!
    : Prisma.sql`(${Prisma.join(candidates, " OR ")})`;
}
