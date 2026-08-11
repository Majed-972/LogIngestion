type CursorData = {
  timestamp: string;
  id: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeCursor(timestamp: Date, id: string): string {
  const data: CursorData = {
    timestamp: timestamp.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

export function decodeCursor(cursor: string): CursorData {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const data = JSON.parse(decoded) as unknown;

    if (
      typeof data !== "object" ||
      data === null ||
      !("timestamp" in data) ||
      !("id" in data) ||
      typeof (data as CursorData).timestamp !== "string" ||
      typeof (data as CursorData).id !== "string"
    ) {
      throw new Error("Invalid cursor structure");
    }

    const cursorData = data as CursorData;

    if (isNaN(Date.parse(cursorData.timestamp)) || !UUID.test(cursorData.id)) {
      throw new Error("Invalid cursor timestamp");
    }

    return cursorData;
  } catch {
    throw new Error("Invalid or malformed cursor");
  }
}
