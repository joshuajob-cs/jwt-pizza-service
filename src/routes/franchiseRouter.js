/**
 * @fileoverview /api/franchise endpoints: list, create, and delete franchises, and create and delete the
 * stores inside them.
 *
 * Who is allowed:
 *   - listing franchises: anyone (admins also see each franchise's admins and store revenue)
 *   - a user's own franchises: that user, or an admin
 *   - creating a franchise: admin only
 *   - creating/deleting a store: an admin, or one of that franchise's admins (a franchisee)
 *   - deleting a franchise: see the NOTE on that route
 */
const express = require('express');
const { DB, Role } = require('../database/database.js');
const { authRouter } = require('./authRouter.js');
const { StatusCodeError, asyncHandler } = require('../endpointHelper.js');

const franchiseRouter = express.Router();

/** Endpoint descriptions served by GET /api/docs (see service.js). Keep in sync with the handlers below. */
franchiseRouter.docs = [
  {
    method: 'GET',
    path: '/api/franchise?page=0&limit=10&name=*',
    description: 'List all the franchises',
    example: `curl localhost:3000/api/franchise&page=0&limit=10&name=pizzaPocket`,
    response: { franchises: [{ id: 1, name: 'pizzaPocket', admins: [{ id: 4, name: 'pizza franchisee', email: 'f@jwt.com' }], stores: [{ id: 1, name: 'SLC', totalRevenue: 0 }] }], more: true },
  },
  {
    method: 'GET',
    path: '/api/franchise/:userId',
    requiresAuth: true,
    description: `List a user's franchises`,
    example: `curl localhost:3000/api/franchise/4  -H 'Authorization: Bearer tttttt'`,
    response: [{ id: 2, name: 'pizzaPocket', admins: [{ id: 4, name: 'pizza franchisee', email: 'f@jwt.com' }], stores: [{ id: 4, name: 'SLC', totalRevenue: 0 }] }],
  },
  {
    method: 'POST',
    path: '/api/franchise',
    requiresAuth: true,
    description: 'Create a new franchise',
    example: `curl -X POST localhost:3000/api/franchise -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt' -d '{"name": "pizzaPocket", "admins": [{"email": "f@jwt.com"}]}'`,
    response: { name: 'pizzaPocket', admins: [{ email: 'f@jwt.com', id: 4, name: 'pizza franchisee' }], id: 1 },
  },
  {
    method: 'DELETE',
    path: '/api/franchise/:franchiseId',
    requiresAuth: true,
    description: `Delete a franchise`,
    example: `curl -X DELETE localhost:3000/api/franchise/1 -H 'Authorization: Bearer tttttt'`,
    response: { message: 'franchise deleted' },
  },
  {
    method: 'POST',
    path: '/api/franchise/:franchiseId/store',
    requiresAuth: true,
    description: 'Create a new franchise store',
    example: `curl -X POST localhost:3000/api/franchise/1/store -H 'Content-Type: application/json' -d '{"franchiseId": 1, "name":"SLC"}' -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: 'SLC', totalRevenue: 0 },
  },
  {
    method: 'DELETE',
    path: '/api/franchise/:franchiseId/store/:storeId',
    requiresAuth: true,
    description: `Delete a store`,
    example: `curl -X DELETE localhost:3000/api/franchise/1/store/1  -H 'Authorization: Bearer tttttt'`,
    response: { message: 'store deleted' },
  },
];

// getFranchises
/**
 * [GET] /api/franchise?page&limit&name - one page of franchises, filtered by name (`*` is a wildcard). No auth.
 * Returns `{ franchises, more }`, where `more` means another page exists.
 * The menu page uses this to fill the store picker; the admin dashboard uses it for its franchise table.
 * What each franchise includes depends on who asks (see DB.getFranchises).
 */
franchiseRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [franchises, more] = await DB.getFranchises(req.user, req.query.page, req.query.limit, req.query.name);
    res.json({ franchises, more });
  })
);

// getUserFranchises
/**
 * [GET] /api/franchise/:userId - the franchises this user is a franchisee of. Requires auth.
 * Only returns data when you ask about yourself or you are an admin; anyone else gets `[]`, not a 403.
 * The franchise dashboard calls this. A plain diner gets `[]`, and the page shows its "why franchise" pitch.
 */
franchiseRouter.get(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    let result = [];
    const userId = Number(req.params.userId);
    if (req.user.id === userId || req.user.isRole(Role.Admin)) {
      result = await DB.getUserFranchises(userId);
    }

    res.json(result);
  })
);

// createFranchise
/**
 * [POST] /api/franchise - create a franchise and make the listed users its franchisees. Admin only (403).
 * Body: `{ name, admins: [{ email }] }`. 404 if an admin email doesn't belong to a user.
 * SQL: SELECT user by email (per admin), INSERT INTO franchise, INSERT INTO userRole (per admin).
 */
franchiseRouter.post(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      throw new StatusCodeError('unable to create a franchise', 403);
    }

    const franchise = req.body;
    res.send(await DB.createFranchise(franchise));
  })
);

// deleteFranchise
/**
 * [DELETE] /api/franchise/:franchiseId - delete a franchise, its stores, and its franchisee roles.
 * SQL (one transaction): DELETE FROM store, DELETE FROM userRole, DELETE FROM franchise.
 *
 * NOTE: unlike every other write route here, this one has no authenticateToken and no admin check,
 * so any caller, even one who isn't logged in, can delete a franchise. The docs array above claims it
 * requires auth.
 */
franchiseRouter.delete(
  '/:franchiseId',
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.params.franchiseId);
    await DB.deleteFranchise(franchiseId);
    res.json({ message: 'franchise deleted' });
  })
);

// createStore
/**
 * [POST] /api/franchise/:franchiseId/store - add a store to a franchise. Requires auth.
 * Allowed for an admin or one of this franchise's admins (403 otherwise). Body: `{ name }`.
 * SQL: DB.getFranchise's two SELECTs (admins, stores), then INSERT INTO store.
 * NOTE: DB.getFranchise always returns an object, so `!franchise` is never true; a missing franchise
 * just has no admins.
 */
franchiseRouter.post(
  '/:franchiseId/store',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.params.franchiseId);
    const franchise = await DB.getFranchise({ id: franchiseId });
    if (!franchise || (!req.user.isRole(Role.Admin) && !franchise.admins.some((admin) => admin.id === req.user.id))) {
      throw new StatusCodeError('unable to create a store', 403);
    }

    res.send(await DB.createStore(franchise.id, req.body));
  })
);

// deleteStore
/**
 * [DELETE] /api/franchise/:franchiseId/store/:storeId - close a store. Requires auth.
 * Same permission check as createStore: an admin or one of this franchise's admins.
 * SQL: DB.getFranchise's two SELECTs, then DELETE FROM store WHERE franchiseId=? AND id=?
 */
franchiseRouter.delete(
  '/:franchiseId/store/:storeId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.params.franchiseId);
    const franchise = await DB.getFranchise({ id: franchiseId });
    if (!franchise || (!req.user.isRole(Role.Admin) && !franchise.admins.some((admin) => admin.id === req.user.id))) {
      throw new StatusCodeError('unable to delete a store', 403);
    }

    const storeId = Number(req.params.storeId);
    await DB.deleteStore(franchiseId, storeId);
    res.json({ message: 'store deleted' });
  })
);

module.exports = franchiseRouter;
