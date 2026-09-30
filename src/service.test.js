const request = require('supertest');
const app = require('./service');
const config = require('./config.js');
const version = require('./version.json');

// Exact on purpose: the ⓻ grader and the AWS ECS exercise check for this message word for word.
test('get welcome', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'welcome to JWT Pizza', version: version.version });
});

test('get docs', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.version).toBe(version.version);
  expect(res.body.config).toEqual({ factory: config.factory.url, db: config.db.connection.host });
  // One entry from each router, so a router dropped from the list is caught.
  expect(res.body.endpoints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: 'POST', path: '/api/auth' }),
      expect.objectContaining({ method: 'GET', path: '/api/user/me' }),
      expect.objectContaining({ method: 'GET', path: '/api/order/menu' }),
      expect.objectContaining({ method: 'POST', path: '/api/franchise' }),
    ]),
  );
});

test('unknown endpoint fails with 404', async () => {
  const res = await request(app).get('/api/nope');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ message: 'unknown endpoint' });
});

// The frontend runs on another origin, so the browser only lets it read responses that echo that origin back.
test('responses allow the caller origin', async () => {
  const res = await request(app).get('/').set('Origin', 'https://pizza.example.com');
  expect(res.headers['access-control-allow-origin']).toBe('https://pizza.example.com');
  expect(res.headers['access-control-allow-headers']).toContain('Authorization');
});
