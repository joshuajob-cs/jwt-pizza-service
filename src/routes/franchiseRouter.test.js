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
  const diner = { name: randomName(), email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(diner);
  const dinerAuthToken = registerRes.body.token;

  const franchise = { name: randomName(), admins: [{ email: diner.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${dinerAuthToken}`).send(franchise);
  expect(createRes.status).toBe(403);
  expect(createRes.body.message).toBe('unable to create a franchise');
});

test('list franchises', async () => {
  const franchise = { name: randomName(), admins: [{ email: adminUser.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);

  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body).toEqual({ franchises: [{ id: createRes.body.id, name: franchise.name, stores: [] }], more: false });
});

test('list franchises reads only one row past the limit', async () => {
  const prefix = randomName();
  for (let i = 0; i < 3; i++) {
    const franchise = { name: prefix + i, admins: [{ email: adminUser.email }] };
    await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);
  }

  const querySpy = jest.spyOn(DB, 'query');
  const listRes = await request(app).get(`/api/franchise?name=${prefix}*&limit=1`);
  const rowsPerQuery = await Promise.all(querySpy.mock.results.map((result) => result.value));
  querySpy.mockRestore();

  expect(listRes.body.franchises).toHaveLength(1);
  expect(listRes.body.more).toBe(true);
  expect(Math.max(...rowsPerQuery.map((rows) => rows.length))).toBeLessThanOrEqual(2);
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
