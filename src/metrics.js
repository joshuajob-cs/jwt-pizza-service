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

/** One OTLP gauge: the current value of something, labelled with this service's source. */
function gauge(name, value, unit) {
  return {
    name,
    unit,
    gauge: {
      dataPoints: [
        {
          asDouble: Number(value),
          timeUnixNano: Date.now() * 1000000,
          attributes: [{ key: 'source', value: { stringValue: config.metrics.source } }],
        },
      ],
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
    sendToGrafana([gauge('cpu', getCpuUsagePercentage(), '%'), gauge('memory', getMemoryUsagePercentage(), '%')]);
  }, period);
}

module.exports = { sendMetricsPeriodically };
