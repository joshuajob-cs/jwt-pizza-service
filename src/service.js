/**
 * @fileoverview Builds the Express app: global middleware, the /api routers, docs, 404, and errors.
 *
 * Every request passes through the middleware below in the order it is registered:
 *   1. express.json()  - parses a JSON body into req.body
 *   2. setAuthUser     - if an Authorization header is present, checks the token and sets req.user
 *   3. CORS headers    - lets the frontend on another origin (localhost:5173) call this service
 *   4. /api routers    - auth, user, order, franchise, docs
 *   5. '*' 404         - nothing matched
 *   6. error handler   - anything thrown (or passed to next(err)) ends up here
 */
const express = require('express');
const { authRouter, setAuthUser } = require('./routes/authRouter.js');
const orderRouter = require('./routes/orderRouter.js');
const franchiseRouter = require('./routes/franchiseRouter.js');
const userRouter = require('./routes/userRouter.js');
const version = require('./version.json');
const config = require('./config.js');

const app = express();
app.use(express.json());
// Runs on EVERY request, before any router, so each authenticated call costs one auth-table lookup.
app.use(setAuthUser);
/** CORS: echo the caller's origin back and allow the Authorization header so the browser permits the call. */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

/** All endpoints live under /api; each router handles the path that remains after its prefix. */
const apiRouter = express.Router();
app.use('/api', apiRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/user', userRouter);
apiRouter.use('/order', orderRouter);
apiRouter.use('/franchise', franchiseRouter);

/**
 * [GET] /api/docs - self-generated API documentation.
 * Joins each router's hand-written `.docs` array; the frontend's Docs page renders this.
 */
apiRouter.use('/docs', (req, res) => {
  res.json({
    version: version.version,
    endpoints: [...authRouter.docs, ...userRouter.docs, ...orderRouter.docs, ...franchiseRouter.docs],
    config: { factory: config.factory.url, db: config.db.connection.host },
  });
});

/** [GET] / - welcome message and the deployed version (a quick "is it up?" check). */
app.get('/', (req, res) => {
  res.json({
    message: 'welcome to JWT Pizza',
    version: version.version,
  });
});

/** Catch-all: any path no router matched gets a 404. */
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'unknown endpoint',
  });
});

// Default error handler for all exceptions and errors.
/**
 * Express recognizes an error handler by its four parameters. Uses err.statusCode when the thrower
 * set one (see StatusCodeError), otherwise 500.
 * NOTE: sends err.stack to the client, which exposes server internals.
 */
app.use((err, req, res, next) => {
  res.status(err.statusCode ?? 500).json({ message: err.message, stack: err.stack });
  next();
});

module.exports = app;
