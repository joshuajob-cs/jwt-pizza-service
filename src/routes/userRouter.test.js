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

test('list users limits the page size and reports more', async () => {
  await registerUser();
  await registerUser();
  await registerUser();
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get('/api/user?limit=2').set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users).toHaveLength(2);
  expect(listUsersRes.body.more).toBe(true);
});

test('list users page 1 continues after page 0', async () => {
  await registerUser();
  await registerUser();
  await registerUser();
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);
  const auth = `Bearer ${loginRes.body.token}`;

  const page0Res = await request(app).get('/api/user?page=0&limit=2').set('Authorization', auth);
  const page1Res = await request(app).get('/api/user?page=1&limit=2').set('Authorization', auth);
  expect(page1Res.status).toBe(200);
  expect(page1Res.body.users).toHaveLength(2);
  const page0Ids = page0Res.body.users.map((user) => user.id);
  for (const user of page1Res.body.users) {
    expect(page0Ids).not.toContain(user.id);
  }
});

test('list users filters by exact name', async () => {
  const { user } = await registerUser();
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get(`/api/user?name=${user.name}`).set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual({ users: [{ id: user.id, name: user.name, email: user.email, roles: [{ role: 'diner' }] }], more: false });
});

test('list users filters with a * wildcard', async () => {
  const { user } = await registerUser();
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app)
    .get(`/api/user?name=*${user.name.substring(2, 8)}*`)
    .set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.map((u) => u.id)).toContain(user.id);
});

test('list users with no name match is empty', async () => {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get('/api/user?name=nobody-has-this-name').set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual({ users: [], more: false });
});

test('list users treats % and _ in the name filter as plain text', async () => {
  const { user } = await registerUser();
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);
  const auth = `Bearer ${loginRes.body.token}`;

  const percentRes = await request(app).get('/api/user?name=%25').set('Authorization', auth);
  expect(percentRes.body).toEqual({ users: [], more: false });

  const underscoreName = user.name.substring(0, 4) + '_' + user.name.substring(5);
  const underscoreRes = await request(app).get(`/api/user?name=${underscoreName}`).set('Authorization', auth);
  expect(underscoreRes.body).toEqual({ users: [], more: false });
});

test('list users rejects a repeated name', async () => {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get('/api/user?name=a&name=b').set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(400);
  expect(listUsersRes.body.message).toBe('name must be a single value');
});

test.each(['limit=abc', 'page=abc', 'limit=1.5', 'limit=0', 'limit=101', 'page=-1'])('list users rejects %s', async (query) => {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);

  const listUsersRes = await request(app).get(`/api/user?${query}`).set('Authorization', `Bearer ${loginRes.body.token}`);
  expect(listUsersRes.status).toBe(400);
  expect(listUsersRes.body.message).toBe('page must be a whole number from 0 and limit from 1 to 100');
});

test('list users fails for a diner', async () => {
  const { token } = await registerUser();

  const listUsersRes = await request(app).get('/api/user').set('Authorization', `Bearer ${token}`);
  expect(listUsersRes.status).toBe(403);
});
