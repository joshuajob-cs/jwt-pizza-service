/**
 * @fileoverview Command-line tool that creates an extra admin user directly in the database.
 *
 * Usage: `node init.js <name> <email> <password>`. It skips the HTTP API entirely and calls
 * DB.addUser, which is the only way to create an admin because POST /api/auth always makes diners.
 */
const { Role, DB } = require('./database/database.js');

if (process.argv.length < 5) {
  console.log('Usage: node init.js <name> <email> <password>');
  process.exit(1);
}

const name = process.argv[2];
const email = process.argv[3];
const password = process.argv[4];
const user = { name, email, password, roles: [{ role: Role.Admin }] };
DB.addUser(user).then((r) => console.log('created user: ', r));
