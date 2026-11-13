const request = require('supertest');
const app = require('./service');
const config = require('./config.js');
const logger = require('./logger.js');

// test/silenceLogging.js stubs sendLogToGrafana on the logger itself; deleting the stub uncovers the real method.
delete logger.sendLogToGrafana;
// Grafana is replaced by a fake fetch that records what would have been sent, so tests never push.
const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });

beforeEach(() => fetchMock.mockClear());

/**
 * Every log line sent to Grafana since this test started with label `type` (http, db, factory, exception),
 * each as `{ labels, data }`: labels are component/level/type, data is the parsed (already sanitized) line.
 */
function sentLogs(type) {
  return fetchMock.mock.calls
    .filter(([url]) => url === config.logging.endpointUrl)
    .map(([, options]) => JSON.parse(options.body).streams[0])
    .filter((stream) => stream.stream.type === type)
    .map((stream) => ({ labels: stream.stream, data: JSON.parse(stream.values[0][1]) }));
}

// TODO: first test (yours)
