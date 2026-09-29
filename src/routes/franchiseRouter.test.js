const request = require('supertest');
const app = require('../service');
// eslint-disable-next-line no-restricted-syntax -- 'list franchises reads only one row past the limit' spies on DB.query; no setup
const { DB } = require('../database/database.js');
const { randomName, createAdminUser, registerUser } = require('./testHelpers.js');

let adminUser;
let adminAuthToken;

beforeAll(async () => {
  adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  adminAuthToken = loginRes.body.token;
});

test('create franchise', async () => {
  const franchise = { name: randomName(), admins: [{ email: adminUser.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);
  expect(createRes.status).toBe(200);
  expect(createRes.body).toMatchObject({ name: franchise.name, admins: [{ email: adminUser.email, id: adminUser.id }] });
});

test('create franchise fails for a non-admin', async () => {
  const { user: diner, token: dinerAuthToken } = await registerUser();

  const franchise = { name: randomName(), admins: [{ email: diner.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${dinerAuthToken}`).send(franchise);
  expect(createRes.status).toBe(403);
  expect(createRes.body.message).toBe('unable to create a franchise');
});

test('list franchises', async () => {
  const franchise = await createFranchise([adminUser]);

  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual({ franchises: [{ id: franchise.id, name: franchise.name, stores: [] }], more: false });
});

test('list franchises reads only one row past the limit', async () => {
  const prefix = randomName();
  for (let i = 0; i < 3; i++) {
    await createFranchise([adminUser], prefix + i);
  }

  const querySpy = jest.spyOn(DB, 'query');
  const listRes = await request(app).get(`/api/franchise?name=${prefix}*&limit=1`);
  const rowsPerQuery = await Promise.all(querySpy.mock.results.map((result) => result.value));
  querySpy.mockRestore();

  expect(listRes.body.franchises).toHaveLength(1);
  expect(listRes.body.more).toBe(true);
  expect(Math.max(...rowsPerQuery.map((rows) => rows.length))).toBeLessThanOrEqual(2);
});

test('get user franchises', async () => {
  const { user: owner, token: ownerAuthToken } = await registerUser();
  const franchise = await createFranchise([owner]);

  const getRes = await request(app).get(`/api/franchise/${owner.id}`).set('Authorization', `Bearer ${ownerAuthToken}`);
  expect(getRes.status).toBe(200);
  expect(getRes.body).toEqual([{ id: franchise.id, name: franchise.name, admins: [{ id: owner.id, name: owner.name, email: owner.email }], stores: [] }]);
});

test('get user franchises fails for another user', async () => {
  const { user: owner } = await registerUser();
  await createFranchise([owner]);
  const { token: strangerAuthToken } = await registerUser();

  const getRes = await request(app).get(`/api/franchise/${owner.id}`).set('Authorization', `Bearer ${strangerAuthToken}`);
  expect(getRes.status).toBe(403);
  expect(getRes.body.message).toBe('unable to get franchises');
});

test('create store', async () => {
  const { user: owner, token: ownerAuthToken } = await registerUser();
  const franchise = await createFranchise([owner]);

  const store = { name: randomName() };
  const createRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${ownerAuthToken}`).send(store);
  expect(createRes.status).toBe(200);
  expect(createRes.body).toEqual({ id: expect.any(Number), franchiseId: franchise.id, name: store.name });
});

test('create store fails for a non-owner', async () => {
  const { user: owner } = await registerUser();
  const franchise = await createFranchise([owner]);
  const { token: strangerAuthToken } = await registerUser();

  const createRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${strangerAuthToken}`).send({ name: randomName() });
  expect(createRes.status).toBe(403);
  expect(createRes.body.message).toBe('unable to create a store');
});

test('create store fails for a missing franchise', async () => {
  const franchise = await createFranchise([adminUser]);
  await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminAuthToken}`);

  const createRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${adminAuthToken}`).send({ name: randomName() });
  expect(createRes.status).toBe(404);
  expect(createRes.body.message).toBe('franchise not found');
});

test('delete store', async () => {
  const { user: owner, token: ownerAuthToken } = await registerUser();
  const franchise = await createFranchise([owner]);
  const store = await createStore(franchise.id, ownerAuthToken);

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', `Bearer ${ownerAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'store deleted' });

  const getRes = await request(app).get(`/api/franchise/${owner.id}`).set('Authorization', `Bearer ${ownerAuthToken}`);
  expect(getRes.body[0].stores).toEqual([]);
});

test('delete store fails for a non-owner', async () => {
  const { user: owner, token: ownerAuthToken } = await registerUser();
  const franchise = await createFranchise([owner]);
  const store = await createStore(franchise.id, ownerAuthToken);
  const { token: strangerAuthToken } = await registerUser();

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', `Bearer ${strangerAuthToken}`);
  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body.message).toBe('unable to delete a store');

  const getRes = await request(app).get(`/api/franchise/${owner.id}`).set('Authorization', `Bearer ${ownerAuthToken}`);
  expect(getRes.body[0].stores.map((s) => s.id)).toEqual([store.id]);
});

test('delete store fails for a missing franchise', async () => {
  const franchise = await createFranchise([adminUser]);
  const store = await createStore(franchise.id, adminAuthToken);
  await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminAuthToken}`);

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', `Bearer ${adminAuthToken}`);
  expect(deleteRes.status).toBe(404);
  expect(deleteRes.body.message).toBe('franchise not found');
});

test('delete franchise', async () => {
  const franchise = await createFranchise([adminUser]);
  for (let i = 0; i < 2; i++) {
    await createStore(franchise.id, adminAuthToken);
  }

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'franchise deleted' });

  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.body.franchises).toEqual([]);
});

/** Creates a franchise as the admin, with `admins` (users with an email) as its franchisees. Returns it with its id. */
async function createFranchise(admins, name = randomName()) {
  const franchise = { name, admins: admins.map((admin) => ({ email: admin.email })) };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);
  return createRes.body;
}

/** Creates a store in the franchise as the user holding `authToken` (an admin or the franchise's owner). Returns it with its id. */
async function createStore(franchiseId, authToken) {
  const createRes = await request(app).post(`/api/franchise/${franchiseId}/store`).set('Authorization', `Bearer ${authToken}`).send({ name: randomName() });
  return createRes.body;
}
