import http from "http";

const HOST = "localhost";
const PORT = 8080;
const PATH_INGEST = "/logs";
const PATH_AGGREGATE =
  "/logs/aggregate?since=2026-08-01T00:00:00Z&until=2026-08-09T23:59:59Z&bucket=1m&group_by=service";

const BATCH_SIZE = 1000;
const CONCURRENT_REQUESTS = 15;
const DURATION_SECONDS = 10;

const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
});

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
}

function generateBatch(size: number): string {
  const services = ["checkout", "auth", "payment", "inventory", "notification"];
  const levels: LogEntry["level"][] = ["debug", "info", "warn", "error"];
  const logs: LogEntry[] = [];

  const now = new Date().toISOString();

  for (let i = 0; i < size; i++) {
    logs.push({
      timestamp: now,
      level: levels[Math.floor(Math.random() * levels.length)]!,
      service: services[Math.floor(Math.random() * services.length)]!,
      message: `Simulated high throughput message payload #${i}`,
      attributes: {
        user_id: String(Math.floor(Math.random() * 10000)),
        region: "us-east-1",
        retry_count: Math.floor(Math.random() * 5),
        is_guest: Math.random() > 0.5,
      },
    });
  }

  return JSON.stringify({ logs });
}

function sendIngestRequest(payload: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: PATH_INGEST,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        agent: keepAliveAgent,
      },
      (res: http.IncomingMessage) => {
        res.resume();
        res.on("end", () => {
          resolve(res.statusCode === 200);
        });
      },
    );

    req.on("error", () => resolve(false));
    req.write(payload);
    req.end();
  });
}

function sendAggregateRequest(): Promise<number> {
  const start = Date.now();
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: PATH_AGGREGATE,
        method: "GET",
        agent: keepAliveAgent,
      },
      (res: http.IncomingMessage) => {
        res.on("data", () => {});
        res.on("end", () => {
          resolve(Date.now() - start);
        });
      },
    );

    req.on("error", () => resolve(-1));
    req.end();
  });
}

async function runLoadTest() {
  console.log("🔥 Starting High Volume Load Test...");
  console.log(
    `🎯 Target: ${BATCH_SIZE * CONCURRENT_REQUESTS} logs per batch wave for ${DURATION_SECONDS} seconds`,
  );

  const payload = generateBatch(BATCH_SIZE);
  let totalAcceptedLogs = 0;
  let successfulRequests = 0;
  let failedRequests = 0;

  const queryLatencies: number[] = [];
  const startTime = Date.now();
  const endTime = startTime + DURATION_SECONDS * 1000;

  let lastQueryTime = 0;

  while (Date.now() < endTime) {
    if (Date.now() - lastQueryTime >= 1000) {
      lastQueryTime = Date.now();
      sendAggregateRequest()
        .then((latency) => {
          if (latency >= 0) queryLatencies.push(latency);
        })
        .catch(() => {});
    }

    const promises: Promise<boolean>[] = [];
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      promises.push(sendIngestRequest(payload));
    }

    const results = await Promise.all(promises);
    results.forEach((success) => {
      if (success) {
        successfulRequests++;
        totalAcceptedLogs += BATCH_SIZE;
      } else {
        failedRequests++;
      }
    });
  }

  const durationSec = (Date.now() - startTime) / 1000;
  const throughput = Math.round(totalAcceptedLogs / durationSec);

  console.log("\n📊 --- LOAD TEST RESULTS ---");
  console.log(`⏱️ Duration: ${durationSec.toFixed(2)} seconds`);
  console.log(`✅ Total Ingested Logs: ${totalAcceptedLogs.toLocaleString()}`);
  console.log(
    `🚀 Ingestion Throughput: ${throughput.toLocaleString()} logs/second`,
  );
  console.log(`📩 Successful Batches: ${successfulRequests}`);
  console.log(`❌ Failed Batches: ${failedRequests}`);

  if (queryLatencies.length > 0) {
    queryLatencies.sort((a, b) => a - b);
    const p95Index = Math.floor(queryLatencies.length * 0.95);
    const p95Latency =
      queryLatencies[p95Index] ?? queryLatencies[queryLatencies.length - 1];
    console.log(`📈 Aggregation Query P95 Latency: ${p95Latency} ms`);
  }

  if (throughput >= 15000) {
    console.log("\n🎉 SUCCESS: Minimum target of 15,000 logs/sec ACHIEVED!");
  } else {
    console.log("\n⚠️ WARNING: Ingestion throughput is below 15,000 logs/sec.");
  }
}

void runLoadTest();
