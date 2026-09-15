/**
 * @fileoverview /api/user endpoints: who am I, and update a user. Delete and list are placeholders the
 * TDD deliverable builds out.
 */
const express = require('express');
const { asyncHandler } = require('../endpointHelper.js');
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
  })
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
  })
);

// deleteUser
/** [DELETE] /api/user/:userId - placeholder; responds 'not implemented'. Built in the TDD deliverable. */
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json({ message: 'not implemented' });
  })
);

// listUsers
/** [GET] /api/user - placeholder; responds with an empty list. Built in the TDD deliverable. */
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json({ message: 'not implemented', users: [], more: false });
  })
);

module.exports = userRouter;
