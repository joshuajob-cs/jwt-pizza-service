/**
 * @fileoverview Runs once before any test file starts: every `npm test` begins with an empty database, like CI's fresh MySQL.
 *
 * Test files run in parallel workers, so clearing has to happen here, before they start, not in each file.
 * It also builds the tables once, so the workers don't all race to create them.
 * Like testHelpers.js, this is setup, so it may reach into the database directly.
 */
const mysql = require('mysql2/promise');

module.exports = async () => {
  require('./useTestDatabase.js');
  const config = require('../src/config.js');
  const { host, user, password, database } = config.db.connection;
  // A DROP on the wrong name would erase real data, so refuse anything that isn't a test database.
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to clear '${database}': not a test database`);
  }

  const connection = await mysql.createConnection({ host, user, password });
  await connection.query(`DROP DATABASE IF EXISTS ${database}`);
  await connection.end();

  const { DB } = require('../src/database/database.js');
  await DB.initialized;
};
