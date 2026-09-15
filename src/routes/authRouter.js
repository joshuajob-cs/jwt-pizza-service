/**
 * @fileoverview /api/auth endpoints (register, login, logout) plus the middleware that decides who is
 * making each request.
 *
 * How a login works: the user object is signed into a JWT with config.jwtSecret, the token's signature
 * is saved in the `auth` table, and the token is returned to the browser. After that, every request that
 * sends `Authorization: Bearer <token>` is recognized by setAuthUser. Logging out deletes the auth row,
 * which kills the token even though its signature is still valid.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config.js');
const { asyncHandler } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');

const authRouter = express.Router();

/** Endpoint descriptions served by GET /api/docs (see service.js). Keep in sync with the handlers below. */
authRouter.docs = [
  {
    method: 'POST',
    path: '/api/auth',
    description: 'Register a new user',
    example: `curl -X POST localhost:3000/api/auth -d '{"name":"pizza diner", "email":"d@jwt.com", "password":"diner"}' -H 'Content-Type: application/json'`,
    response: { user: { id: 2, name: 'pizza diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] }, token: 'tttttt' },
  },
  {
    method: 'PUT',
    path: '/api/auth',
    description: 'Login existing user',
    example: `curl -X PUT localhost:3000/api/auth -d '{"email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
  {
    method: 'DELETE',
    path: '/api/auth',
    requiresAuth: true,
    description: 'Logout a user',
    example: `curl -X DELETE localhost:3000/api/auth -H 'Authorization: Bearer tttttt'`,
    response: { message: 'logout successful' },
  },
];

/**
 * Global middleware (registered in service.js) that sets `req.user` when the request has a valid token.
 *
 * Two checks must both pass:
 *   1. DB.isLoggedIn - the token's signature is still in the auth table (not logged out).
 *      SQL: SELECT userId FROM auth WHERE token=?
 *   2. jwt.verify   - the token was signed with our secret and hasn't been tampered with.
 * On success req.user is the token's payload (id, name, email, roles) plus an `isRole(role)` helper.
 * It never rejects a request: with no or bad token req.user just stays unset, and routes that
 * need a user use authenticateToken to send the 401.
 *
 * NOTE: req.user comes from the token, not a fresh database read, so role changes made after login
 * (e.g. becoming a franchisee) don't show up in req.user until the user logs in again.
 */
async function setAuthUser(req, res, next) {
  const token = readAuthToken(req);
  if (token) {
    try {
      if (await DB.isLoggedIn(token)) {
        // Check the database to make sure the token is valid.
        req.user = jwt.verify(token, config.jwtSecret);
        req.user.isRole = (role) => !!req.user.roles.find((r) => r.role === role);
      }
    } catch {
      req.user = null;
    }
  }
  next();
}

// Authenticate token
/**
 * Per-route guard: responds 401 `{ message: 'unauthorized' }` unless setAuthUser found a valid user.
 * Put it before the handler on any route that needs a logged-in user.
 */
authRouter.authenticateToken = (req, res, next) => {
  if (!req.user) {
    return res.status(401).send({ message: 'unauthorized' });
  }
  next();
};

// register
/**
 * [POST] /api/auth - register a new user. Always creates a diner; there is no way to choose a role here.
 * Body: `{ name, email, password }`. Returns `{ user, token }`. 400 if a field is missing.
 * SQL (DB.addUser, then setAuth): INSERT INTO user, INSERT INTO userRole, INSERT INTO auth.
 */
authRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email, and password are required' });
    }
    const user = await DB.addUser({ name, email, password, roles: [{ role: Role.Diner }] });
    const auth = await setAuth(user);
    res.json({ user: user, token: auth });
  })
);

// login
/**
 * [PUT] /api/auth - log in an existing user.
 * Body: `{ email, password }`. Returns `{ user, token }`. 404 'unknown user' on a wrong email or password.
 * SQL (DB.getUser, then setAuth): SELECT user by email, SELECT userRole by userId, INSERT INTO auth.
 */
authRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await DB.getUser(email, password);
    const auth = await setAuth(user);
    res.json({ user: user, token: auth });
  })
);

// logout
/**
 * [DELETE] /api/auth - log out by deleting this token's row from the auth table. Requires auth.
 * SQL: DELETE FROM auth WHERE token=?
 */
authRouter.delete(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    await clearAuth(req);
    res.json({ message: 'logout successful' });
  })
);

/**
 * Creates a JWT for the user and records it as logged in.
 * The whole user object (id, name, email, roles) becomes the token payload.
 * @param {{id: number}} user
 * @returns {Promise<string>} the signed token to send to the client
 */
async function setAuth(user) {
  const token = jwt.sign(user, config.jwtSecret);
  await DB.loginUser(user.id, token);
  return token;
}

/** Removes the request's token from the auth table, so setAuthUser rejects it from now on. */
async function clearAuth(req) {
  const token = readAuthToken(req);
  if (token) {
    await DB.logoutUser(token);
  }
}

/**
 * Pulls the token out of an `Authorization: Bearer <token>` header.
 * @returns {string|null} the token, or null when there is no header
 */
function readAuthToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    return authHeader.split(' ')[1];
  }
  return null;
}

module.exports = { authRouter, setAuthUser, setAuth };
