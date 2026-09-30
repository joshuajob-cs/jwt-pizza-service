const request = require('supertest');
const app = require('../service');
const { randomName, createAdminUser, registerUser } = require('./testHelpers.js');

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

test('add menu item', async () => {
  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0042 };

  const addRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminAuthToken}`).send(item);
  expect(addRes.status).toBe(200);
  expect(addRes.body).toContainEqual({ ...item, id: expect.any(Number) });
});

test('add menu item fails for a non-admin', async () => {
  const { token: dinerAuthToken } = await registerUser();
  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0042 };

  const addRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${dinerAuthToken}`).send(item);
  expect(addRes.status).toBe(403);
  expect(addRes.body.message).toBe('unable to add menu item');
});

test('get orders', async () => {
  const { user: diner, token: dinerAuthToken } = await registerUser();

  const getRes = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`);
  expect(getRes.status).toBe(200);
  expect(getRes.body).toEqual({ dinerId: diner.id, orders: [], page: 1 });
});
