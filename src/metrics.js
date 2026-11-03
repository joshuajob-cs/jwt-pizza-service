/**
 * @fileoverview Collects service metrics and pushes them to Grafana Cloud as OpenTelemetry (OTLP) JSON.
 *
 * The rest of the service only records what happened; this file decides what gets sent and when.
 * Sending starts from index.js, not service.js, so the tests (which load service.js) never push.
 */
const os = require('os');
const config = require('./config.js');

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

// Running HTTP request counts by method, since the service started. Never reset: Grafana's
// rate() turns a running count into requests/minute, and the total is the sum of the methods.
const requests = { GET: 0, PUT: 0, POST: 0, DELETE: 0, OTHER: 0 };

// Running total of time spent answering requests, in ms. Never reset, like the request counts:
// Grafana's average latency is rate(this) / rate(sum of http_requests).
let latencyTotalMs = 0;

function recordLatency(ms) {
  latencyTotalMs += ms;
}

// Running counts of login attempts by outcome. Never reset, like the request counts.
// failure = the user's fault (wrong email/password); error = ours (e.g. the DB is down).
const authAttempts = { success: 0, failure: 0, error: 0 };

/** Express middleware for the login route: once the response is sent, its status code says how the attempt went. */
function authTracker(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode === 200) {
      authAttempts.success++;
    } else if (res.statusCode >= 500) {
      authAttempts.error++;
    } else {
      authAttempts.failure++;
    }
  });
  next();
}

// A user is active if they made a request in the last 15 minutes. Map of user id → last request time (ms).
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const lastSeen = new Map();

/** Forget users who haven't made a request within the window, and return how many are left. */
function countActiveUsers() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [userId, time] of lastSeen) {
    if (time < cutoff) {
      lastSeen.delete(userId);
    }
  }
  return lastSeen.size;
}

/** Express middleware: counts every incoming request by its method, times it, and notes who made it. */
function requestTracker(req, res, next) {
  const method = req.method in requests ? req.method : 'OTHER';
  requests[method]++;
  // 'finish' fires once the response has been handed to the network, so this covers the whole
  // route: auth lookup, DB queries, and the factory call for orders.
  const start = performance.now();
  res.on('finish', () => {
    recordLatency(performance.now() - start);
    // setAuthUser runs after this middleware, so req.user is only known by the time the response finishes.
    if (req.user) {
      lastSeen.set(req.user.id, Date.now());
    }
  });
  next();
}

/** One OTLP data point stamped now, labelled with this service's source plus any extra attributes. */
function dataPoint(valueType, value, attributes = {}) {
  attributes = { ...attributes, source: config.metrics.source };
  return {
    [valueType]: value,
    timeUnixNano: Date.now() * 1000000,
    attributes: Object.entries(attributes).map(([key, v]) => ({ key, value: { stringValue: v } })),
  };
}

/** One OTLP gauge: the current value of something that goes up and down (CPU %, memory %). */
function gauge(name, value, unit) {
  return { name, unit, gauge: { dataPoints: [dataPoint('asDouble', Number(value))] } };
}

/** One OTLP counter: a running total that only goes up, with one data point per attribute set. */
function counter(name, points, unit = '1') {
  return {
    name,
    unit,
    sum: {
      dataPoints: points.map(({ value, attributes }) => dataPoint('asInt', value, attributes)),
      aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
      isMonotonic: true,
    },
  };
}

/** POST a list of OTLP metrics to Grafana in one request. Failures are logged, never thrown. */
async function sendToGrafana(metrics) {
  const body = JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics }] }] });
  try {
    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      body,
      headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error(`Failed to push metrics to Grafana: ${await response.text()}`);
    }
  } catch (error) {
    console.error('Error pushing metrics:', error);
  }
}

/** Every `period` ms, gather the current metrics and send them in one batch. */
function sendMetricsPeriodically(period) {
  setInterval(() => {
    const requestPoints = Object.entries(requests).map(([method, value]) => ({ value, attributes: { method } }));
    const authPoints = Object.entries(authAttempts).map(([result, value]) => ({ value, attributes: { result } }));
    sendToGrafana([
      gauge('cpu', getCpuUsagePercentage(), '%'),
      gauge('memory', getMemoryUsagePercentage(), '%'),
      counter('http_requests', requestPoints),
      counter('http_latency', [{ value: Math.round(latencyTotalMs) }], 'ms'),
      counter('auth_attempts', authPoints),
      gauge('active_users', countActiveUsers(), '{users}'),
    ]);
  }, period);
}

module.exports = { requestTracker, authTracker, sendMetricsPeriodically };
