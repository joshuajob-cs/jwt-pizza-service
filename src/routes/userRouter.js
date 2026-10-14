/**
 * @fileoverview /api/user endpoints: who am I, update a user, and (admin only) list and delete users.
 */
const express = require('express');
const { asyncHandler, StatusCodeError } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');

const userRouter = express.Router();

/** Endpoint descriptions served by GET /api/docs (see service.js). Keep in sync with the handlers below. */
userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
  {
    method: 'GET',
    path: '/api/user?page=0&limit=10&name=*',
    requiresAuth: true,
    description: 'List users (admin only). page from 0, limit 1-100, name with * wildcards',
    example: `curl -X GET 'localhost:3000/api/user?page=0&limit=10&name=*' -H 'Authorization: Bearer tttttt'`,
    response: { users: [{ id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }], more: false },
  },
  {
    method: 'DELETE',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Delete user (admin only). Removes their roles and tokens; their orders stay',
    example: `curl -X DELETE localhost:3000/api/user/2 -H 'Authorization: Bearer tttttt'`,
    response: { message: 'user deleted' },
  },
];

// getUser
/**
 * [GET] /api/user/me - the logged-in user. Requires auth.
 * Returns req.user as-is: the token's payload, with no extra database query beyond setAuthUser's auth check.
 * The frontend calls this when the app loads, to restore the user from a token saved in localStorage.
 */
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  }),
);

// updateUser
/**
 * [PUT] /api/user/:userId - change a user's name, email, and/or password, then issue a fresh token.
 * Requires auth; allowed for yourself or an admin (403 otherwise). Body: `{ name, email, password }`.
 * Returns `{ user, token }`.
 * NOTE: see DB.updateUser; it builds its SQL by pasting values into the string.
 */
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    const userId = Number(req.params.userId);
    const user = req.user;
    if (user.id !== userId && !user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const updatedUser = await DB.updateUser(userId, name, email, password);
    const auth = await setAuth(updatedUser);
    res.json({ user: updatedUser, token: auth });
  }),
);

// deleteUser
/**
 * [DELETE] /api/user/:userId - admin only (403 otherwise). Removes the user, their roles, and their tokens;
 * their orders stay. 400 when the id isn't a whole number, 404 for an unknown id. See DB.deleteUser.
 */
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) {
      throw new StatusCodeError('userId must be a whole number', 400);
    }

    await DB.deleteUser(userId);
    res.json({ message: 'user deleted' });
  }),
);

// listUsers
/**
 * [GET] /api/user - admin only (403 otherwise). `?page` (from 0, default 0) and `?limit` (1-100, default 10);
 * anything else is a 400. `?name` filters by name, `*` as a wildcard; sent twice it's a 400.
 * Returns `{ users, more }`. See DB.getUsers.
 */
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const page = Number(req.query.page ?? 0);
    const limit = Number(req.query.limit ?? 10);
    if (!Number.isInteger(page) || page < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new StatusCodeError('page must be a whole number from 0 and limit from 1 to 100', 400);
    }
    if (Array.isArray(req.query.name)) {
      throw new StatusCodeError('name must be a single value', 400);
    }

    const [users, more] = await DB.getUsers(page, limit, req.query.name);
    res.json({ users, more });
  }),
);

module.exports = userRouter;
