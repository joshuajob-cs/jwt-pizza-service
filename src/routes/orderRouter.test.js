const request = require('supertest');
const app = require('../service');
const config = require('../config.js');
const { randomName, createAdminUser, registerUser } = require('./testHelpers.js');

let adminAuthToken;

beforeAll(async () => {
  const adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  adminAuthToken = loginRes.body.token;
});

// Put back anything a test replaced (like fetch), even if that test failed partway through.
afterEach(() => {
  jest.restoreAllMocks();
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

test('create order', async () => {
  const { user: diner, token: dinerAuthToken } = await registerUser();
  const menuItem = await addMenuItem();
  const orderReq = { franchiseId: 1, storeId: 1, items: [{ menuId: menuItem.id, description: menuItem.title, price: menuItem.price }] };

  // Stand in for the Factory: no network call, and a known answer to check against.
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ jwt: 'factory-jwt', reportUrl: 'factory-report' }) });
  const orderRes = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`).send(orderReq);

  expect(orderRes.status).toBe(200);
  expect(orderRes.body).toEqual({ order: { ...orderReq, id: expect.any(Number) }, jwt: 'factory-jwt', followLinkToEndChaos: 'factory-report' });

  const [url, options] = fetchSpy.mock.calls[0];
  expect(url).toBe(`${config.factory.url}/api/order`);
  expect(JSON.parse(options.body)).toEqual({ diner: { id: diner.id, name: diner.name, email: diner.email }, order: orderRes.body.order });
});

/** Adds a pizza to the menu as the admin. Returns the new menu item with its id. */
async function addMenuItem() {
  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0042 };
  const addRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminAuthToken}`).send(item);
  return addRes.body.find((menuItem) => menuItem.title === item.title);
}
