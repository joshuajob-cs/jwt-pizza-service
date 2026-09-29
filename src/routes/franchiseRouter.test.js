const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

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

test('create store', async () => {
  const { user: owner, token: ownerAuthToken } = await registerUser();
  const franchise = await createFranchise([owner]);

  const store = { name: randomName() };
  const createRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${ownerAuthToken}`).send(store);
  expect(createRes.status).toBe(200);
  expect(createRes.body).toEqual({ id: expect.any(Number), franchiseId: franchise.id, name: store.name });
});

test('delete store', async () => {
  const { user: owner, token: ownerAuthToken } = await registerUser();
  const franchise = await createFranchise([owner]);
  const createRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${ownerAuthToken}`).send({ name: randomName() });

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${createRes.body.id}`).set('Authorization', `Bearer ${ownerAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'store deleted' });

  const getRes = await request(app).get(`/api/franchise/${owner.id}`).set('Authorization', `Bearer ${ownerAuthToken}`);
  expect(getRes.body[0].stores).toEqual([]);
});

test('delete franchise', async () => {
  const franchise = await createFranchise([adminUser]);
  await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${adminAuthToken}`).send({ name: randomName() });

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'franchise deleted' });

  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.body.franchises).toEqual([]);
});

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

/** Registers a new diner through the API. Returns `{ user, token }`; user has id, name, and email. */
async function registerUser() {
  const newUser = { name: randomName(), email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  return registerRes.body;
}

/** Creates a franchise as the admin, with `admins` (users with an email) as its franchisees. Returns it with its id. */
async function createFranchise(admins, name = randomName()) {
  const franchise = { name, admins: admins.map((admin) => ({ email: admin.email })) };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);
  return createRes.body;
}
