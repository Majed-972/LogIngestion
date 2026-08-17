type CursorData = {
  timestamp: string;
  id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(timestamp: Date | string, id: string): string {
  const tsStr =
    timestamp instanceof Date
      ? timestamp.toISOString()
      : new Date(timestamp).toISOString();
  const data: CursorData = {
    timestamp: tsStr,
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
      throw new Error("Invalid cursor timestamp or id");
    }

    return cursorData;
  } catch {
    throw new Error("Invalid or malformed cursor");
  }
}
