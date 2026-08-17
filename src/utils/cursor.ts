type CursorData = {
  timestamp: string;
  id: string;
};

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
      typeof (data as CursorData).id !== "string" ||
      (data as CursorData).id.length === 0
    ) {
      throw new Error("Invalid cursor structure");
    }

    const cursorData = data as CursorData;

    if (isNaN(Date.parse(cursorData.timestamp))) {
      throw new Error("Invalid cursor timestamp");
    }

    return cursorData;
  } catch {
    throw new Error("Invalid or malformed cursor");
  }
}
