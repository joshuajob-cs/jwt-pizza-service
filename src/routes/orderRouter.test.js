const request = require('supertest');
const app = require('../service');
const { randomName, createAdminUser } = require('./testHelpers.js');

let adminAuthToken;

beforeAll(async () => {
  const adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  adminAuthToken = loginRes.body.token;
});

test('get menu', async () => {
  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0042 };
  await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminAuthToken}`).send(item);

  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toContainEqual({ ...item, id: expect.any(Number) });
});
