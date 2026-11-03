const request = require('supertest');
const app = require('./service');
const metrics = require('./metrics.js');

// Grafana is replaced by a fake fetch that records what would have been sent, so tests never push.
const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });

/** Fire the send timer once (fake timers, so no 10-second wait) and return the batch of metrics it sent. */
function sendNow() {
  fetchMock.mockClear();
  jest.useFakeTimers();
  metrics.sendMetricsPeriodically(1000);
  jest.advanceTimersByTime(1000);
  jest.clearAllTimers();
  jest.useRealTimers();
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  return body.resourceMetrics[0].scopeMetrics[0].metrics;
}

/** The value of metric `name` in a batch, from the data point whose attributes include all of `attributes`. */
function valueOf(batch, name, attributes = {}) {
  const metric = batch.find((m) => m.name === name);
  const points = (metric.sum || metric.gauge).dataPoints;
  const point = points.find((p) => Object.entries(attributes).every(([key, v]) => p.attributes.some((a) => a.key === key && a.value.stringValue === v)));
  return point.asDouble;
}

test('GET request is counted', async () => {
  // TODO: send a GET with supertest, then assert http_requests{method: 'GET'} in sendNow()'s batch.
  // Counters never reset and every test in this file shares them, so decide: exact value, or before/after?
});
