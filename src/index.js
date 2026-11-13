/**
 * @fileoverview Entry point: starts the Express app from service.js listening on a port.
 *
 * Run with `npm start` (which is `cd src && node index.js`). The port comes from the first
 * command-line argument, e.g. `node index.js 4000`, and defaults to 3000.
 *
 * Errors thrown outside any request (the metrics timer, database startup, a promise nobody awaits) never reach
 * Express's error handler. The handlers below log them to Grafana, then exit so ECS starts a fresh task.
 * They live here, not in service.js, so tests never install them.
 */
const app = require('./service.js');
const metrics = require('./metrics.js');
const logger = require('./logger.js');

/** Log a crash as an exception, wait for it to reach Grafana, then exit: the process may be left in a broken state. */
async function logCrashAndExit(error, origin) {
  // If Grafana never answers, exit anyway.
  setTimeout(() => process.exit(1), 5000).unref();
  await logger.log('error', 'exception', { origin, message: error?.message ?? String(error), stack: error?.stack });
  process.exit(1);
}
process.on('uncaughtException', (error) => logCrashAndExit(error, 'uncaughtException'));
process.on('unhandledRejection', (reason) => logCrashAndExit(reason, 'unhandledRejection'));

metrics.sendMetricsPeriodically(10000);

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
