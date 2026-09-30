const request = require('supertest');
const app = require('../service');
const { randomName, registerUser } = require('./testHelpers.js');

test('get me', async () => {
  const { user, token } = await registerUser();

  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject({ id: user.id, name: user.name, email: user.email, roles: [{ role: 'diner' }] });
});

test('update user', async () => {
  const { user, token } = await registerUser();
  const changes = { name: randomName(), email: randomName() + '@test.com', password: 'b' };

  const updateRes = await request(app).put(`/api/user/${user.id}`).set('Authorization', `Bearer ${token}`).send(changes);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: user.id, name: changes.name, email: changes.email });

  const loginRes = await request(app).put('/api/auth').send({ email: changes.email, password: changes.password });
  expect(loginRes.status).toBe(200);
});

test('update user fails for another user', async () => {
  const { user: victim } = await registerUser();
  const { token: strangerAuthToken } = await registerUser();

  const updateRes = await request(app).put(`/api/user/${victim.id}`).set('Authorization', `Bearer ${strangerAuthToken}`).send({ name: randomName() });
  expect(updateRes.status).toBe(403);
  expect(updateRes.body.message).toBe('unauthorized');
});
