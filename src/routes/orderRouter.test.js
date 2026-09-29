const request = require('supertest');
const app = require('../service');
const { DB } = require('../database/database.js');
const { randomName } = require('./testHelpers.js');

test('get menu', async () => {
  const item = await DB.addMenuItem({ title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0042 });

  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toContainEqual(item);
});
