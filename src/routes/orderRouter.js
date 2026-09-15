/**
 * @fileoverview /api/order endpoints: read and extend the menu, list a diner's orders, and place an
 * order, which is saved to MySQL and then sent to the JWT Pizza Factory to be "made".
 */
const express = require('express');
const config = require('../config.js');
const { Role, DB } = require('../database/database.js');
const { authRouter } = require('./authRouter.js');
const { asyncHandler, StatusCodeError } = require('../endpointHelper.js');

const orderRouter = express.Router();

/** Endpoint descriptions served by GET /api/docs (see service.js). Keep in sync with the handlers below. */
orderRouter.docs = [
  {
    method: 'GET',
    path: '/api/order/menu',
    description: 'Get the pizza menu',
    example: `curl localhost:3000/api/order/menu`,
    response: [{ id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' }],
  },
  {
    method: 'PUT',
    path: '/api/order/menu',
    requiresAuth: true,
    description: 'Add an item to the menu',
    example: `curl -X PUT localhost:3000/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Student", "description": "No topping, no sauce, just carbs", "image":"pizza9.png", "price": 0.0001 }'  -H 'Authorization: Bearer tttttt'`,
    response: [{ id: 1, title: 'Student', description: 'No topping, no sauce, just carbs', image: 'pizza9.png', price: 0.0001 }],
  },
  {
    method: 'GET',
    path: '/api/order',
    requiresAuth: true,
    description: 'Get the orders for the authenticated user',
    example: `curl -X GET localhost:3000/api/order  -H 'Authorization: Bearer tttttt'`,
    response: { dinerId: 4, orders: [{ id: 1, franchiseId: 1, storeId: 1, date: '2024-06-05T05:14:40.000Z', items: [{ id: 1, menuId: 1, description: 'Veggie', price: 0.05 }] }], page: 1 },
  },
  {
    method: 'POST',
    path: '/api/order',
    requiresAuth: true,
    description: 'Create a order for the authenticated user',
    example: `curl -X POST localhost:3000/api/order -H 'Content-Type: application/json' -d '{"franchiseId": 1, "storeId":1, "items":[{ "menuId": 1, "description": "Veggie", "price": 0.05 }]}'  -H 'Authorization: Bearer tttttt'`,
    response: { order: { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }], id: 1 }, jwt: '1111111111' },
  },
];

// getMenu
/**
 * [GET] /api/order/menu - every pizza on the menu. No auth.
 * SQL: SELECT * FROM menu
 */
orderRouter.get(
  '/menu',
  asyncHandler(async (req, res) => {
    res.send(await DB.getMenu());
  })
);

// addMenuItem
/**
 * [PUT] /api/order/menu - add a pizza to the menu, then return the whole menu. Admin only (403 otherwise).
 * Body: `{ title, description, image, price }`.
 * SQL: INSERT INTO menu ..., then SELECT * FROM menu
 */
orderRouter.put(
  '/menu',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to add menu item', 403);
    }

    const addMenuItemReq = req.body;
    await DB.addMenuItem(addMenuItemReq);
    res.send(await DB.getMenu());
  })
);

// getOrders
/**
 * [GET] /api/order?page=N - the logged-in diner's order history, one page at a time. Requires auth.
 * The diner comes from the token (req.user), never from the URL, so you can only see your own orders.
 * SQL: SELECT ... FROM dinerOrder WHERE dinerId=? LIMIT ..., then SELECT ... FROM orderItem for each order
 */
orderRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(await DB.getOrders(req.user, req.query.page));
  })
);

// createOrder
/**
 * [POST] /api/order - place an order for the logged-in diner. Requires auth.
 * Body: `{ franchiseId, storeId, items: [{ menuId, description, price }] }`.
 *
 * Steps:
 *   1. Save the order (DB.addDinerOrder: INSERT dinerOrder, then per item SELECT menu id + INSERT orderItem).
 *   2. POST the diner and order to the Factory at `${config.factory.url}/api/order`, authenticating with
 *      this service's factory API key (not the user's token).
 *   3. The Factory returns a signed pizza JWT; send `{ order, jwt, followLinkToEndChaos }` back.
 * If the Factory fails, respond 500. The order row stays saved anyway.
 * `followLinkToEndChaos` is the Factory's report URL, used in the chaos-testing deliverable.
 *
 * NOTE: item prices come from the request body as sent by the client; they aren't looked up from the menu.
 */
orderRouter.post(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const orderReq = req.body;
    const order = await DB.addDinerOrder(req.user, orderReq);
    const r = await fetch(`${config.factory.url}/api/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${config.factory.apiKey}` },
      body: JSON.stringify({ diner: { id: req.user.id, name: req.user.name, email: req.user.email }, order }),
    });
    const j = await r.json();
    if (r.ok) {
      res.send({ order, followLinkToEndChaos: j.reportUrl, jwt: j.jwt });
    } else {
      res.status(500).send({ message: 'Failed to fulfill order at factory', followLinkToEndChaos: j.reportUrl });
    }
  })
);

module.exports = orderRouter;
