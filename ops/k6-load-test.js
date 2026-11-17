import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "10s", target: 50 },  // Ramp-up
    { duration: "30s", target: 100 }, // Sustained 100 rps load
    { duration: "10s", target: 0 },   // Ramp-down
  ],
  thresholds: {
    // Master Plan budget: p95 latency < 300ms
    http_req_duration: ["p(95)<300"],
    http_req_failed: ["rate<0.01"], // Less than 1% failure rate
  },
};

const BASE_URL = __ENV.API_URL || "http://localhost:3000";

export default function () {
  // 1. Health liveness probe
  const healthRes = http.get(`${BASE_URL}/health/live`);
  check(healthRes, {
    "health status is 200": (r) => r.status === 200,
  });

  // 2. Public license plans query
  const plansRes = http.get(`${BASE_URL}/v1/licenses/plans`);
  check(plansRes, {
    "plans status is 200": (r) => r.status === 200,
  });

  // 3. Prometheus metrics probe
  const metricsRes = http.get(`${BASE_URL}/metrics`);
  check(metricsRes, {
    "metrics status is 200": (r) => r.status === 200,
  });

  sleep(0.5);
}
