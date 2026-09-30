const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('login fails with a wrong password', async () => {
  const loginRes = await request(app).put('/api/auth').send({ email: testUser.email, password: 'wrong' });
  expect(loginRes.status).toBe(404);
  expect(loginRes.body.message).toBe('unknown user');
});

test('logout', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  const token = loginRes.body.token;

  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toBe('logout successful');

  const reuseRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`);
  expect(reuseRes.status).toBe(401);
});

test('register', async () => {
  const newUser = { name: 'pizza diner', email: Math.random().toString(36).substring(2, 12) + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  expect(registerRes.status).toBe(200);
  expectValidJwt(registerRes.body.token);

  const expectedUser = { ...newUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(registerRes.body.user).toMatchObject(expectedUser);
  expect(registerRes.body.user.password).toBeUndefined();
});

test('register fails without a password', async () => {
  const registerRes = await request(app).post('/api/auth').send({ name: testUser.name, email: testUser.email });
  expect(registerRes.status).toBe(400);
  expect(registerRes.body.message).toBe('name, email, and password are required');
});

// Every route behind authenticateToken. The user list/delete stubs are left to ⓹, and DELETE /api/franchise/:id has no guard (a known hole).
test.each([
  ['DELETE', '/api/auth'],
  ['GET', '/api/user/me'],
  ['PUT', '/api/user/1'],
  ['PUT', '/api/order/menu'],
  ['GET', '/api/order'],
  ['POST', '/api/order'],
  ['GET', '/api/franchise/1'],
  ['POST', '/api/franchise'],
  ['POST', '/api/franchise/1/store'],
  ['DELETE', '/api/franchise/1/store/1'],
])('%s %s fails without a token', async (method, path) => {
  const res = await request(app)[method.toLowerCase()](path);
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('get me fails with a garbage token', async () => {
  const meRes = await request(app).get('/api/user/me').set('Authorization', 'Bearer not-a-jwt');
  expect(meRes.status).toBe(401);
});

test('get me fails with a token signed by the wrong secret', async () => {
  const forgedToken = jwt.sign({ id: 1, roles: [{ role: 'admin' }] }, 'not-the-real-secret');
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${forgedToken}`);
  expect(meRes.status).toBe(401);
});

// The signature is a real, logged-in one, so DB.isLoggedIn passes and only jwt.verify catches the edited payload.
test('get me fails with a real token whose payload was edited to admin', async () => {
  const [header, payload, signature] = testUserAuthToken.split('.');
  const user = JSON.parse(Buffer.from(payload, 'base64url').toString());
  user.roles = [{ role: 'admin' }];
  const tamperedToken = [header, Buffer.from(JSON.stringify(user)).toString('base64url'), signature].join('.');

  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${tamperedToken}`);
  expect(meRes.status).toBe(401);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}
