const request = require('supertest');
const app = require('../service');
const config = require('../config.js');
const { randomName } = require('../routes/testHelpers.js');
// eslint-disable-next-line no-restricted-syntax -- addDefaultAdmin only runs at startup; no endpoint reaches it.
const { DB } = require('./database.js');

// addDefaultAdmin reads config.defaultAdmin, so each test sets it and this puts it back.
const savedDefaultAdmin = config.defaultAdmin;
afterEach(() => {
  config.defaultAdmin = savedDefaultAdmin;
  jest.restoreAllMocks();
});

test('addDefaultAdmin creates the admin from config', async () => {
  const admin = { name: randomName(), email: randomName() + '@admin.com', password: randomName() };
  config.defaultAdmin = admin;

  await DB.addDefaultAdmin();

  const loginRes = await request(app).put('/api/auth').send({ email: admin.email, password: admin.password });
  expect(loginRes.status).toBe(200);
  expect(loginRes.body.user).toMatchObject({ name: admin.name, roles: [{ role: 'admin' }] });
});

test('addDefaultAdmin creates no admin when config has none', async () => {
  delete config.defaultAdmin;
  const addUser = jest.spyOn(DB, 'addUser');

  await DB.addDefaultAdmin();

  expect(addUser).not.toHaveBeenCalled();
});
