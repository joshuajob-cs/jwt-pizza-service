/**
 * @fileoverview Points the service at its own database while Jest runs, so tests never touch the dev `pizza` data.
 *
 * Runs before each test file (jest `setupFiles`) and in globalSetup. It changes the shared config object before
 * database.js is first required, and database.js reads the name from that object on every connection.
 */
const config = require('../src/config.js');

config.db.connection.database = 'pizza_test';
