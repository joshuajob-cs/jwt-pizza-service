/**
 * @fileoverview Two helpers every router uses: an error type that carries an HTTP status, and a
 * wrapper that sends errors from async route handlers to Express's error handler.
 */

/**
 * An Error that knows which HTTP status code it should produce.
 * Throw it for expected failures, e.g. `throw new StatusCodeError('unknown user', 404)`;
 * the error handler in service.js reads `statusCode` to set the response status.
 */
class StatusCodeError extends Error {
  /**
   * @param {string} message - text sent back to the client as `{ message }`
   * @param {number} statusCode - HTTP status, e.g. 403 or 404
   */
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Wraps an async route handler so a thrown error or rejected promise reaches Express's error handler.
 * Express 4 does not do this itself: without the wrapper a failed `await` would leave the request
 * hanging with no response.
 *
 * @param {(req, res, next) => Promise<void>} fn - the async handler
 * @returns {(req, res, next) => Promise<void>} a normal Express handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  asyncHandler,
  StatusCodeError,
};
