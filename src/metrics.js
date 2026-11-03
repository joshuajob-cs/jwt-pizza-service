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

/** Express middleware: counts every incoming request by its method, then passes it on. */
function requestTracker(req, res, next) {
  const method = req.method in requests ? req.method : 'OTHER';
  requests[method]++;
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
    sendToGrafana([gauge('cpu', getCpuUsagePercentage(), '%'), gauge('memory', getMemoryUsagePercentage(), '%'), counter('http_requests', requestPoints)]);
  }, period);
}

module.exports = { requestTracker, sendMetricsPeriodically };
