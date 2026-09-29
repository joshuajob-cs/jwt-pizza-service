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
