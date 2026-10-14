const request = require('supertest');
const app = require('../service');
const { randomName, createAdminUser, registerUser } = require('./testHelpers.js');

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
  expect(updateRes.body.user.password).toBeUndefined();

  // The new token belongs to the updated user.
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${updateRes.body.token}`);
  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject({ id: user.id, name: changes.name, email: changes.email });

  const loginRes = await request(app).put('/api/auth').send({ email: changes.email, password: changes.password });
  expect(loginRes.status).toBe(200);
});

test('update user name only', async () => {
  const { user, token } = await registerUser();
  const newName = randomName();

  const updateRes = await request(app).put(`/api/user/${user.id}`).set('Authorization', `Bearer ${token}`).send({ name: newName });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: user.id, name: newName, email: user.email });
});

test('update user by an admin', async () => {
  const { user } = await registerUser();
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);
  const newName = randomName();

  const updateRes = await request(app).put(`/api/user/${user.id}`).set('Authorization', `Bearer ${loginRes.body.token}`).send({ name: newName });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: user.id, name: newName, email: user.email });
});

test('update user fails for another user', async () => {
  const { user: victim } = await registerUser();
  const { token: strangerAuthToken } = await registerUser();

  const updateRes = await request(app).put(`/api/user/${victim.id}`).set('Authorization', `Bearer ${strangerAuthToken}`).send({ name: randomName() });
  expect(updateRes.status).toBe(403);
  expect(updateRes.body.message).toBe('unauthorized');
});

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users', async () => {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get('/api/user').set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(200);
});

test('list users returns users without passwords', async () => {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get('/api/user').set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.length).toBeGreaterThan(0);
  for (const user of listUsersRes.body.users) {
    expect(user).toMatchObject({ id: expect.any(Number), name: expect.any(String), email: expect.any(String), roles: expect.any(Array) });
    expect(user.password).toBeUndefined();
  }
});

test('list users fails for a diner', async () => {
  const { token } = await registerUser();

  const listUsersRes = await request(app).get('/api/user').set('Authorization', `Bearer ${token}`);
  expect(listUsersRes.status).toBe(403);
});
