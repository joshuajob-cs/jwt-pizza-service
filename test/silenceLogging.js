/**
 * @fileoverview Keeps Jest from sending logs to Grafana.
 *
 * Runs before each test file (jest `setupFiles`). Every log ends in logger.sendLogToGrafana, so replacing only that
 * method stops the network call while httpLogger, log(), and sanitize() still run for real. It is a plain function,
 * not a jest.spyOn, so the jest.restoreAllMocks() in the route tests' afterEach can't put the real one back.
 */
const logger = require('../src/logger.js');

logger.sendLogToGrafana = () => {};
