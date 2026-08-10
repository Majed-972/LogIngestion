import http from "http";

const HOST = "localhost";
const PORT = 8080;

function request(
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runSmokeTest() {
  console.log("🩺 Running Ingestion Service Smoke Test...\n");

  try {
    // ─── 1. Health Check ─────────────────────────────────────────────────────
    console.log("1️⃣  GET /health");
    const health = await request({
      hostname: HOST,
      port: PORT,
      path: "/health",
      method: "GET",
    });
    if (health.statusCode !== 200)
      throw new Error(`/health returned status ${health.statusCode}`);
    console.log("   ✅ Status 200\n");

    // ─── 2. Ingest valid batch ────────────────────────────────────────────────
    console.log("2️⃣  POST /logs — valid batch");
    const logPayload = JSON.stringify({
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "info",
          service: "smoke-checkout",
          message: "smoke test ingestion log",
          attributes: { user_id: "smoke-1", is_smoke: true },
        },
        {
          timestamp: new Date().toISOString(),
          level: "error",
          service: "smoke-payment",
          message: "smoke test error log",
          attributes: { user_id: "smoke-2", retries: 3 },
        },
      ],
    });
    const ingest = await request(
      {
        hostname: HOST,
        port: PORT,
        path: "/logs",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      logPayload,
    );
    if (ingest.statusCode !== 200)
      throw new Error(
        `/logs POST returned status ${ingest.statusCode}: ${ingest.body}`,
      );
    const ingestJson = JSON.parse(ingest.body) as {
      accepted: number;
      rejected: unknown[];
    };
    if (ingestJson.accepted !== 2)
      throw new Error(`Expected accepted=2, got ${ingestJson.accepted}`);
    if (!Array.isArray(ingestJson.rejected))
      throw new Error(`Response missing 'rejected' array`);
    console.log(
      `   ✅ accepted=${ingestJson.accepted}, rejected=${ingestJson.rejected.length}\n`,
    );

    // ─── 3. Ingest mixed batch (valid + invalid) ──────────────────────────────
    console.log("3️⃣  POST /logs — mixed batch (valid + invalid entries)");
    const mixedPayload = JSON.stringify({
      logs: [
        {
          timestamp: new Date().toISOString(),
          level: "warn",
          service: "smoke-auth",
          message: "valid entry",
          attributes: {},
        },
        {
          timestamp: new Date().toISOString(),
          level: "critical",
          service: "smoke-auth",
          message: "invalid level",
        },
        {
          timestamp: new Date().toISOString(),
          level: "info",
          service: "",
          message: "empty service",
        },
        {
          timestamp: "not-a-date",
          level: "info",
          service: "smoke-auth",
          message: "bad timestamp",
        },
      ],
    });
    const mixed = await request(
      {
        hostname: HOST,
        port: PORT,
        path: "/logs",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      mixedPayload,
    );
    if (mixed.statusCode !== 200)
      throw new Error(`Mixed batch returned status ${mixed.statusCode}`);
    const mixedJson = JSON.parse(mixed.body) as {
      accepted: number;
      rejected: { index: number; reason: string }[];
    };
    if (mixedJson.accepted !== 1)
      throw new Error(`Expected accepted=1, got ${mixedJson.accepted}`);
    if (mixedJson.rejected.length !== 3)
      throw new Error(`Expected 3 rejected, got ${mixedJson.rejected.length}`);
    console.log(
      `   ✅ accepted=${mixedJson.accepted}, rejected=${mixedJson.rejected.length}`,
    );
    console.log(
      `   ✅ Rejected entries: ${mixedJson.rejected.map((r) => `[${r.index}] ${r.reason}`).join(" | ")}\n`,
    );

    // ─── 4. All-invalid batch returns 400 ────────────────────────────────────
    console.log("4️⃣  POST /logs — all-invalid batch must return 400");
    const badPayload = JSON.stringify({
      logs: [
        { timestamp: "bad-ts", level: "info", service: "x", message: "x" },
      ],
    });
    const bad = await request(
      {
        hostname: HOST,
        port: PORT,
        path: "/logs",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      badPayload,
    );
    if (bad.statusCode !== 400)
      throw new Error(
        `Expected 400 for all-invalid batch, got ${bad.statusCode}`,
      );
    console.log("   ✅ Status 400 returned correctly\n");

    // ─── 5. Query logs ────────────────────────────────────────────────────────
    console.log("5️⃣  GET /logs — basic query");
    const getLogs = await request({
      hostname: HOST,
      port: PORT,
      path: "/logs?service=smoke-checkout&limit=10",
      method: "GET",
    });
    if (getLogs.statusCode !== 200)
      throw new Error(
        `/logs GET returned status ${getLogs.statusCode}: ${getLogs.body}`,
      );
    const logsJson = JSON.parse(getLogs.body) as {
      logs: unknown[];
      next_cursor: string | null;
    };
    if (!Array.isArray(logsJson.logs) || logsJson.logs.length === 0)
      throw new Error(`No logs returned: ${getLogs.body}`);
    if (!("next_cursor" in logsJson))
      throw new Error(`Response missing 'next_cursor' field`);
    console.log(
      `   ✅ Returned ${logsJson.logs.length} log(s), next_cursor=${String(logsJson.next_cursor)}\n`,
    );

    // ─── 6. Pagination ────────────────────────────────────────────────────────
    console.log("6️⃣  GET /logs — cursor-based pagination");
    const page1 = await request({
      hostname: HOST,
      port: PORT,
      path: "/logs?limit=1",
      method: "GET",
    });
    const page1Json = JSON.parse(page1.body) as {
      logs: unknown[];
      next_cursor: string | null;
    };
    if (!page1Json.next_cursor)
      throw new Error("Expected next_cursor on page 1");
    const page2 = await request({
      hostname: HOST,
      port: PORT,
      path: `/logs?limit=1&cursor=${encodeURIComponent(page1Json.next_cursor)}`,
      method: "GET",
    });
    if (page2.statusCode !== 200)
      throw new Error(`Pagination page 2 returned status ${page2.statusCode}`);
    console.log("   ✅ Pagination works correctly\n");

    // ─── 7. Invalid query params return 400 ──────────────────────────────────
    console.log("7️⃣  GET /logs — invalid params must return 400");
    const invalidLimit = await request({
      hostname: HOST,
      port: PORT,
      path: "/logs?limit=9999",
      method: "GET",
    });
    if (invalidLimit.statusCode !== 400)
      throw new Error(
        `Expected 400 for limit=9999, got ${invalidLimit.statusCode}`,
      );
    const invalidLevel = await request({
      hostname: HOST,
      port: PORT,
      path: "/logs?level=critical",
      method: "GET",
    });
    if (invalidLevel.statusCode !== 400)
      throw new Error(
        `Expected 400 for level=critical, got ${invalidLevel.statusCode}`,
      );
    const invalidSinceUntil = await request({
      hostname: HOST,
      port: PORT,
      path: "/logs?since=2026-08-10T10:00:00Z&until=2026-08-10T09:00:00Z",
      method: "GET",
    });
    if (invalidSinceUntil.statusCode !== 400)
      throw new Error(
        `Expected 400 for until < since, got ${invalidSinceUntil.statusCode}`,
      );
    console.log("   ✅ All invalid params return 400\n");

    // ─── 8. Aggregate ────────────────────────────────────────────────────────
    console.log("8️⃣  GET /logs/aggregate — time-bucketed aggregation");
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const agg = await request({
      hostname: HOST,
      port: PORT,
      path: `/logs/aggregate?since=${since}&until=${until}&bucket=1m&group_by=service`,
      method: "GET",
    });
    if (agg.statusCode !== 200)
      throw new Error(
        `/logs/aggregate returned status ${agg.statusCode}: ${agg.body}`,
      );
    const aggJson = JSON.parse(agg.body) as {
      buckets: { start: string; group: string | null; count: number }[];
    };
    if (!Array.isArray(aggJson.buckets) || aggJson.buckets.length === 0)
      throw new Error(`No buckets returned: ${agg.body}`);
    const bucket = aggJson.buckets[0]!;
    if (
      !bucket.start ||
      !("group" in bucket) ||
      typeof bucket.count !== "number"
    )
      throw new Error(`Bucket shape invalid: ${JSON.stringify(bucket)}`);
    console.log(`   ✅ Returned ${aggJson.buckets.length} bucket(s)`);
    console.log(
      `   ✅ Bucket shape: start=${bucket.start}, group=${String(bucket.group)}, count=${bucket.count}\n`,
    );

    // ─── 9. Aggregate invalid params ─────────────────────────────────────────
    console.log("9️⃣  GET /logs/aggregate — invalid params must return 400");
    const missingBucket = await request({
      hostname: HOST,
      port: PORT,
      path: `/logs/aggregate?since=${since}&until=${until}`,
      method: "GET",
    });
    if (missingBucket.statusCode !== 400)
      throw new Error(
        `Expected 400 for missing bucket, got ${missingBucket.statusCode}`,
      );
    const badGroupBy = await request({
      hostname: HOST,
      port: PORT,
      path: `/logs/aggregate?since=${since}&until=${until}&bucket=1m&group_by=region`,
      method: "GET",
    });
    if (badGroupBy.statusCode !== 400)
      throw new Error(
        `Expected 400 for group_by=region, got ${badGroupBy.statusCode}`,
      );
    console.log("   ✅ All invalid aggregate params return 400\n");

    // ─────────────────────────────────────────────────────────────────────────
    console.log("🎉 ALL SMOKE TESTS PASSED — API CONTRACT VERIFIED!\n");
    process.exit(0);
  } catch (error: unknown) {
    console.error("❌ SMOKE TEST FAILED:");
    if (error instanceof Error) console.error("  ", error.message);
    process.exit(1);
  }
}

await runSmokeTest();
