const request = require('supertest');
const app = require('./service');
const config = require('./config.js');
const logger = require('./logger.js');
// eslint-disable-next-line no-restricted-syntax -- stubbing DB calls is the only way to force a 500 or skip order setup
const { DB } = require('./database/database.js');
const { registerUser } = require('./routes/testHelpers.js');

// test/silenceLogging.js stubs sendLogToGrafana on the logger itself; deleting the stub uncovers the real method.
delete logger.sendLogToGrafana;
// Grafana is replaced by a fake fetch that records what would have been sent, so tests never push.
const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });

// Reset to the default every test: a factory test swaps in its own reply.
beforeEach(() => {
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => ({ ok: true }));
});

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

test('login password never reaches Grafana', async () => {
  await request(app).put('/api/auth').send({ email: 'nobody@test.com', password: 'secret-password' });
  const { reqBody } = sentLogs('http')[0].data;
  // Both: ***** alone would still pass if the real password were logged too.
  expect(reqBody).toContain('*****');
  expect(reqBody).not.toContain('secret-password');
});

test('auth token never reaches Grafana', async () => {
  const { token } = await registerUser();
  const { resBody } = sentLogs('http').find(({ data }) => data.path === '/api/auth').data;
  expect(resBody).toContain('*****');
  expect(resBody).not.toContain(token);
});

test('emails never reach Grafana; userId identifies the user instead', async () => {
  const { user } = await registerUser();
  await request(app).put('/api/auth').send({ email: user.email, password: 'a' });
  const lines = ['http', 'db'].flatMap((type) => sentLogs(type));
  // Both: an empty line list would pass the not-contain check without testing anything.
  expect(lines.some(({ data }) => JSON.stringify(data).includes('*****'))).toBe(true);
  for (const { data } of lines) {
    expect(JSON.stringify(data)).not.toContain(user.email);
  }
});

test('password hash never reaches the db log', async () => {
  const { user, token } = await registerUser();
  fetchMock.mockClear();
  await request(app).put(`/api/user/${user.id}`).set('Authorization', `Bearer ${token}`).send({ password: 'new-password' });
  const sqls = sentLogs('db').map(({ data }) => data.sql);
  expect(sqls.some((sql) => sql.startsWith('UPDATE user'))).toBe(true);
  // Every bcrypt hash starts $2a$/$2b$/$2y$.
  for (const sql of sqls) {
    expect(sql).not.toMatch(/\$2[aby]\$/);
  }
});

describe('http log', () => {
  test('level follows the status code', async () => {
    await request(app).get('/');
    await request(app).get('/api/nope');
    const menuSpy = jest.spyOn(DB, 'getMenu').mockRejectedValue(new Error('database is down'));
    try {
      await request(app).get('/api/order/menu');
    } finally {
      menuSpy.mockRestore();
    }
    expect(sentLogs('http').map(({ labels, data }) => [data.statusCode, labels.level])).toEqual([
      [200, 'info'],
      [404, 'warn'],
      [500, 'error'],
    ]);
  });

  test('labels say which environment sent it', async () => {
    await request(app).get('/');
    expect(sentLogs('http')[0].labels).toEqual({ component: config.logging.source, level: 'info', type: 'http' });
  });
});

describe('requesting user', () => {
  test('signed-in request puts userId on its http and db lines', async () => {
    const { user, token } = await registerUser();
    fetchMock.mockClear();
    await request(app).get('/api/order').set('Authorization', `Bearer ${token}`);
    expect(sentLogs('http')[0].data.userId).toBe(user.id);
    // The token check runs before req.user is set, so only the queries after it carry the user.
    const dbUserIds = sentLogs('db').map(({ data }) => data.userId);
    expect(dbUserIds).toContain(user.id);
  });

  test('anonymous request has no userId', async () => {
    await request(app).get('/');
    expect(sentLogs('http')[0].data).not.toHaveProperty('userId');
  });
});

describe('factory log', () => {
  /** Order one pizza with the Factory answering `factoryReply`; the order row itself is stubbed, not saved. */
  async function orderWith(factoryReply) {
    const { token } = await registerUser();
    const order = { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
    const addOrderSpy = jest.spyOn(DB, 'addDinerOrder').mockResolvedValue({ ...order, id: 1 });
    fetchMock.mockImplementation(async (url) => (url.startsWith(config.factory.url) ? factoryReply() : { ok: true }));
    try {
      return await request(app).post('/api/order').set('Authorization', `Bearer ${token}`).send(order);
    } finally {
      addOrderSpy.mockRestore();
    }
  }

  test('a made order logs what was sent and what came back', async () => {
    await orderWith(() => ({ ok: true, json: async () => ({ jwt: 'factory-jwt', reportUrl: 'factory-report' }) }));
    const [{ labels, data }] = sentLogs('factory');
    expect(labels.level).toBe('info');
    expect(data.reqBody).toContain('Veggie');
    expect(data.resBody).toContain('factory-report');
    // The diner goes to the factory with an email, but the log keeps only the id.
    expect(data.reqBody).not.toContain('@test.com');
    expect(data.reqBody).toContain(`"id":${data.userId}`);
  });

  test('the pizza jwt never reaches Grafana', async () => {
    await orderWith(() => ({ ok: true, json: async () => ({ jwt: 'factory-jwt', reportUrl: 'factory-report' }) }));
    // The factory line logs the factory's reply; the http line logs ours, which passes the jwt on.
    for (const { data } of [...sentLogs('factory'), ...sentLogs('http')]) {
      expect(JSON.stringify(data)).not.toContain('factory-jwt');
    }
  });

  test('a factory refusal is an error', async () => {
    await orderWith(() => ({ ok: false, json: async () => ({ reportUrl: 'factory-report' }) }));
    expect(sentLogs('factory')[0].labels.level).toBe('error');
  });

  test('an unreachable factory logs the error and the order gets a 500', async () => {
    const res = await orderWith(() => Promise.reject(new Error('factory offline')));
    expect(res.status).toBe(500);
    const [{ labels, data }] = sentLogs('factory');
    expect(labels.level).toBe('error');
    expect(data.error).toBe('factory offline');
    expect(data.reqBody).toContain('Veggie');
  });
});

describe('exception log', () => {
  test('a 500 logs the stack, and the client never sees it', async () => {
    const menuSpy = jest.spyOn(DB, 'getMenu').mockRejectedValue(new Error('database is down'));
    let res;
    try {
      res = await request(app).get('/api/order/menu');
    } finally {
      menuSpy.mockRestore();
    }
    const [{ data }] = sentLogs('exception');
    expect(data).toMatchObject({ message: 'database is down', statusCode: 500 });
    expect(data.stack).toContain('database is down');
    expect(res.body).toEqual({ message: 'database is down' });
  });

  test('a 404 is not an exception', async () => {
    await request(app).put('/api/auth').send({ email: 'nobody@test.com', password: 'x' });
    expect(sentLogs('exception')).toEqual([]);
  });
});

describe('a failed send to Grafana', () => {
  /** Log once with `fetchMock` already primed to fail, and return what was written to console.error. */
  async function errorsFromLog() {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await logger.log('info', 'test', { hello: 'world' });
      return errorSpy.mock.calls;
    } finally {
      errorSpy.mockRestore();
    }
  }

  test('a rejected log is reported, not thrown', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, text: async () => 'invalid token' });
    expect(await errorsFromLog()).toEqual([['Failed to send log to Grafana: invalid token']]);
  });

  test('an unreachable Grafana is reported, not thrown', async () => {
    const offline = new Error('offline');
    fetchMock.mockRejectedValueOnce(offline);
    expect(await errorsFromLog()).toEqual([['Error sending log to Grafana:', offline]]);
  });
});
