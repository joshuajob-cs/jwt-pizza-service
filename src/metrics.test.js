const request = require('supertest');
const app = require('./service');
const metrics = require('./metrics.js');
// eslint-disable-next-line no-restricted-syntax -- 'a database outage is an error' makes DB.getUser throw; no setup
const { DB } = require('./database/database.js');
const { registerUser } = require('./routes/testHelpers.js');

// Grafana is replaced by a fake fetch that records what would have been sent, so tests never push.
const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });

/**
 * Fire the send timer once (fake timers, so no 10-second wait) and return the batch of metrics it sent.
 * `laterMs` sends as if that much time had passed, for metrics that depend on the clock.
 */
function sendNow(laterMs = 0) {
  fetchMock.mockClear();
  jest.useFakeTimers({ now: Date.now() + laterMs });
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

// Counters never reset and every test in this file shares them, so tests check the change, not the total.
test('GET request is counted', async () => {
  const before = valueOf(sendNow(), 'http_requests', { method: 'GET' });
  await request(app).get('/');
  const after = valueOf(sendNow(), 'http_requests', { method: 'GET' });
  expect(after - before).toBe(1);
});

test('each request method is counted', async () => {
  const batchBefore = sendNow();
  await request(app).post('/api/nope');
  await request(app).put('/api/nope');
  await request(app).delete('/api/nope');
  await request(app).patch('/api/nope');
  const batchAfter = sendNow();
  for (const method of ['POST', 'PUT', 'DELETE', 'OTHER']) {
    expect(valueOf(batchAfter, 'http_requests', { method }) - valueOf(batchBefore, 'http_requests', { method })).toBe(1);
  }
});

test('request time is added to latency', async () => {
  const before = valueOf(sendNow(), 'http_latency');
  await request(app).get('/api/docs');
  const after = valueOf(sendNow(), 'http_latency');
  expect(after).toBeGreaterThan(before);
});

describe('login attempts', () => {
  /** Log in with `password` and return how much each auth_attempts result went up. */
  async function loginChange(email, password) {
    const batchBefore = sendNow();
    await request(app).put('/api/auth').send({ email, password });
    const batchAfter = sendNow();
    const change = {};
    for (const result of ['success', 'failure', 'error']) {
      change[result] = valueOf(batchAfter, 'auth_attempts', { result }) - valueOf(batchBefore, 'auth_attempts', { result });
    }
    return change;
  }

  test('right password is a success', async () => {
    const { user } = await registerUser();
    expect(await loginChange(user.email, 'a')).toEqual({ success: 1, failure: 0, error: 0 });
  });

  test('wrong password is a failure', async () => {
    const { user } = await registerUser();
    expect(await loginChange(user.email, 'wrong')).toEqual({ success: 0, failure: 1, error: 0 });
  });

  test('a database outage is an error, not a failure', async () => {
    const { user } = await registerUser();
    // Only this spy is restored: restoreAllMocks would also put the real fetch back and send to Grafana.
    const getUserSpy = jest.spyOn(DB, 'getUser').mockRejectedValue(new Error('database is down'));
    try {
      expect(await loginChange(user.email, 'a')).toEqual({ success: 0, failure: 0, error: 1 });
    } finally {
      getUserSpy.mockRestore();
    }
  });

  test('registering is not a login attempt', async () => {
    const batchBefore = sendNow();
    await registerUser();
    const batchAfter = sendNow();
    expect(valueOf(batchAfter, 'auth_attempts', { result: 'success' })).toBe(valueOf(batchBefore, 'auth_attempts', { result: 'success' }));
  });
});

describe('active users', () => {
  test('a signed-in request makes the user active', async () => {
    const { token } = await registerUser();
    const before = valueOf(sendNow(), 'active_users');
    await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
    expect(valueOf(sendNow(), 'active_users')).toBe(before + 1);
  });

  test('a request without a token makes no one active', async () => {
    const before = valueOf(sendNow(), 'active_users');
    await request(app).get('/');
    expect(valueOf(sendNow(), 'active_users')).toBe(before);
  });

  test('users drop off after 15 minutes without a request', async () => {
    const { token } = await registerUser();
    await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
    expect(valueOf(sendNow(), 'active_users')).toBeGreaterThan(0);
    expect(valueOf(sendNow(16 * 60 * 1000), 'active_users')).toBe(0);
  });
});
