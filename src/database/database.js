/**
 * @fileoverview The whole data layer: a DB class with one method per database operation. Routers never
 * write SQL themselves; they call these methods.
 *
 * Patterns that repeat in every method:
 *   - Each method opens its own MySQL connection with getConnection() and closes it in `finally`.
 *     There is no connection pool.
 *   - `?` placeholders in SQL are filled from the params array by mysql2, which keeps user input out
 *     of the SQL text. Anything pasted in with `${...}` instead is not protected.
 *   - A single shared instance is created when this file is first required (bottom of file), and that
 *     starts initializeDatabase(). Every method waits for that to finish before querying.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const config = require('../config.js');
const { StatusCodeError } = require('../endpointHelper.js');
const { Role } = require('../model/model.js');
const dbModel = require('./dbModel.js');
class DB {
  /** Starts creating the database and tables; `this.initialized` is the promise every query waits on. */
  constructor() {
    this.initialized = this.initializeDatabase();
  }

  /**
   * All menu items.
   * SQL: SELECT * FROM menu
   * @returns {Promise<Array<{id, title, image, price, description}>>}
   */
  async getMenu() {
    const connection = await this.getConnection();
    try {
      const rows = await this.query(connection, `SELECT * FROM menu`);
      return rows;
    } finally {
      connection.end();
    }
  }

  /**
   * Adds one pizza to the menu.
   * SQL: INSERT INTO menu (title, description, image, price) VALUES (?, ?, ?, ?)
   * @param {{title: string, description: string, image: string, price: number}} item
   * @returns {Promise<object>} the item plus its new `id`
   */
  async addMenuItem(item) {
    const connection = await this.getConnection();
    try {
      const addResult = await this.query(connection, `INSERT INTO menu (title, description, image, price) VALUES (?, ?, ?, ?)`, [item.title, item.description, item.image, item.price]);
      return { ...item, id: addResult.insertId };
    } finally {
      connection.end();
    }
  }

  /**
   * Creates a user with a bcrypt-hashed password and one userRole row per role.
   * SQL: INSERT INTO user (name, email, password) VALUES (?, ?, ?)
   *      INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)   (once per role)
   * For a franchisee role, `role.object` is the franchise *name*, which is looked up to get the objectId.
   * @param {{name: string, email: string, password: string, roles: Array<{role: string, object?: string}>}} user
   * @returns {Promise<object>} the user with its new `id` and `password` removed
   */
  async addUser(user) {
    const connection = await this.getConnection();
    try {
      const hashedPassword = await bcrypt.hash(user.password, 10);

      const userResult = await this.query(connection, `INSERT INTO user (name, email, password) VALUES (?, ?, ?)`, [user.name, user.email, hashedPassword]);
      const userId = userResult.insertId;
      for (const role of user.roles) {
        switch (role.role) {
          case Role.Franchisee: {
            const franchiseId = await this.getID(connection, 'name', role.object, 'franchise');
            await this.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, [userId, role.role, franchiseId]);
            break;
          }
          default: {
            await this.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, [userId, role.role, 0]);
            break;
          }
        }
      }
      return { ...user, id: userId, password: undefined };
    } finally {
      connection.end();
    }
  }

  /**
   * Looks up a user by email, checks the password, and attaches their roles. Used by login.
   * SQL: SELECT * FROM user WHERE email=?
   *      SELECT * FROM userRole WHERE userId=?
   * The password is checked with bcrypt.compare against the stored hash. If `password` is empty the check
   * is skipped entirely (updateUser relies on this).
   * @param {string} email
   * @param {string} [password]
   * @returns {Promise<object>} `{ id, name, email, roles: [{ role, objectId }] }` with password removed
   * @throws {StatusCodeError} 404 'unknown user' when the email doesn't exist or the password is wrong
   */
  async getUser(email, password) {
    const connection = await this.getConnection();
    try {
      const userResult = await this.query(connection, `SELECT * FROM user WHERE email=?`, [email]);
      const user = userResult[0];
      if (!user || (password && !(await bcrypt.compare(password, user.password)))) {
        throw new StatusCodeError('unknown user', 404);
      }

      const roleResult = await this.query(connection, `SELECT * FROM userRole WHERE userId=?`, [user.id]);
      const roles = roleResult.map((r) => {
        return { objectId: r.objectId || undefined, role: r.role };
      });

      return { ...user, roles: roles, password: undefined };
    } finally {
      connection.end();
    }
  }

  /**
   * Updates whichever of name, email, and password were provided, then re-reads the user.
   * SQL: UPDATE user SET ... WHERE id=...
   * NOTE: the values are pasted straight into the SQL string instead of using `?` placeholders, so a
   * crafted name or email can change the query (SQL injection).
   * NOTE: it re-reads with getUser(email, password), which fails when no email was sent.
   * @returns {Promise<object>} the updated user, as getUser returns it
   */
  async updateUser(userId, name, email, password) {
    const connection = await this.getConnection();
    try {
      const params = [];
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        params.push(`password='${hashedPassword}'`);
      }
      if (email) {
        params.push(`email='${email}'`);
      }
      if (name) {
        params.push(`name='${name}'`);
      }
      if (params.length > 0) {
        const query = `UPDATE user SET ${params.join(', ')} WHERE id=${userId}`;
        await this.query(connection, query);
      }
      return this.getUser(email, password);
    } finally {
      connection.end();
    }
  }

  /**
   * Records a token as logged in by storing its signature.
   * SQL: INSERT INTO auth (token, userId) VALUES (?, ?) ON DUPLICATE KEY UPDATE token=token
   * `ON DUPLICATE KEY UPDATE token=token` does nothing if the same token is already there, instead of erroring.
   */
  async loginUser(userId, token) {
    token = this.getTokenSignature(token);
    const connection = await this.getConnection();
    try {
      await this.query(connection, `INSERT INTO auth (token, userId) VALUES (?, ?) ON DUPLICATE KEY UPDATE token=token`, [token, userId]);
    } finally {
      connection.end();
    }
  }

  /**
   * Is this token still logged in? Called by setAuthUser on every request that carries a token.
   * SQL: SELECT userId FROM auth WHERE token=?
   * @returns {Promise<boolean>}
   */
  async isLoggedIn(token) {
    token = this.getTokenSignature(token);
    const connection = await this.getConnection();
    try {
      const authResult = await this.query(connection, `SELECT userId FROM auth WHERE token=?`, [token]);
      return authResult.length > 0;
    } finally {
      connection.end();
    }
  }

  /**
   * Logs a token out by deleting its row.
   * SQL: DELETE FROM auth WHERE token=?
   */
  async logoutUser(token) {
    token = this.getTokenSignature(token);
    const connection = await this.getConnection();
    try {
      await this.query(connection, `DELETE FROM auth WHERE token=?`, [token]);
    } finally {
      connection.end();
    }
  }

  /**
   * One page of a diner's orders, each with its items.
   * SQL: SELECT id, franchiseId, storeId, date FROM dinerOrder WHERE dinerId=? LIMIT offset,listPerPage
   *      SELECT id, menuId, description, price FROM orderItem WHERE orderId=?   (once per order)
   * @param {{id: number}} user - the diner (from the token)
   * @param {number} [page=1] - 1-based page number; page size is config.db.listPerPage
   * @returns {Promise<{dinerId: number, orders: object[], page: number}>}
   */
  async getOrders(user, page = 1) {
    const connection = await this.getConnection();
    try {
      const offset = this.getOffset(page, config.db.listPerPage);
      const orders = await this.query(connection, `SELECT id, franchiseId, storeId, date FROM dinerOrder WHERE dinerId=? LIMIT ${offset},${config.db.listPerPage}`, [user.id]);
      for (const order of orders) {
        let items = await this.query(connection, `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`, [order.id]);
        order.items = items;
      }
      return { dinerId: user.id, orders: orders, page };
    } finally {
      connection.end();
    }
  }

  /**
   * Saves a new order and its items. Called by POST /api/order before the Factory is contacted.
   * SQL: INSERT INTO dinerOrder (dinerId, franchiseId, storeId, date) VALUES (?, ?, ?, now())
   *      SELECT id FROM menu WHERE id=?   (per item, via getID; throws if the menu item doesn't exist)
   *      INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)   (per item)
   * @param {{id: number}} user - the diner
   * @param {{franchiseId: number, storeId: number, items: Array<{menuId, description, price}>}} order
   * @returns {Promise<object>} the order plus its new `id`
   */
  async addDinerOrder(user, order) {
    const connection = await this.getConnection();
    try {
      const orderResult = await this.query(connection, `INSERT INTO dinerOrder (dinerId, franchiseId, storeId, date) VALUES (?, ?, ?, now())`, [user.id, order.franchiseId, order.storeId]);
      const orderId = orderResult.insertId;
      for (const item of order.items) {
        const menuId = await this.getID(connection, 'id', item.menuId, 'menu');
        await this.query(connection, `INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)`, [orderId, menuId, item.description, item.price]);
      }
      return { ...order, id: orderId };
    } finally {
      connection.end();
    }
  }

  /**
   * Creates a franchise and gives each listed admin the franchisee role for it.
   * SQL: SELECT id, name FROM user WHERE email=?   (per admin; 404 if not found, before anything is inserted)
   *      INSERT INTO franchise (name) VALUES (?)
   *      INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)   (per admin, objectId = franchise id)
   * @param {{name: string, admins: Array<{email: string}>}} franchise
   * @returns {Promise<object>} the franchise with its `id`, and each admin filled in with `id` and `name`
   * @throws {StatusCodeError} 404 when an admin email is not a user
   */
  async createFranchise(franchise) {
    const connection = await this.getConnection();
    try {
      for (const admin of franchise.admins) {
        const adminUser = await this.query(connection, `SELECT id, name FROM user WHERE email=?`, [admin.email]);
        if (adminUser.length == 0) {
          throw new StatusCodeError(`unknown user for franchise admin ${admin.email} provided`, 404);
        }
        admin.id = adminUser[0].id;
        admin.name = adminUser[0].name;
      }

      const franchiseResult = await this.query(connection, `INSERT INTO franchise (name) VALUES (?)`, [franchise.name]);
      franchise.id = franchiseResult.insertId;

      for (const admin of franchise.admins) {
        await this.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, [admin.id, Role.Franchisee, franchise.id]);
      }

      return franchise;
    } finally {
      connection.end();
    }
  }

  /**
   * Deletes a franchise with its stores and franchisee roles, all-or-nothing in one transaction.
   * SQL: DELETE FROM store WHERE franchiseId=?
   *      DELETE FROM userRole WHERE objectId=?
   *      DELETE FROM franchise WHERE id=?
   * Stores go first because store.franchiseId is a foreign key to franchise. If any delete fails, rollback
   * undoes the others.
   * NOTE: `userRole WHERE objectId=?` doesn't check the role, and objectId is only meaningful for franchisees.
   * @throws {StatusCodeError} 500 when the transaction fails
   */
  async deleteFranchise(franchiseId) {
    const connection = await this.getConnection();
    try {
      await connection.beginTransaction();
      try {
        await this.query(connection, `DELETE FROM store WHERE franchiseId=?`, [franchiseId]);
        await this.query(connection, `DELETE FROM userRole WHERE objectId=?`, [franchiseId]);
        await this.query(connection, `DELETE FROM franchise WHERE id=?`, [franchiseId]);
        await connection.commit();
      } catch {
        await connection.rollback();
        throw new StatusCodeError('unable to delete franchise', 500);
      }
    } finally {
      connection.end();
    }
  }

  /**
   * One page of franchises whose name matches a filter, with their stores.
   * SQL: SELECT id, name FROM franchise WHERE name LIKE ? LIMIT limit+1 OFFSET offset
   *   then, for each franchise:
   *   - admin caller:  getFranchise (admins, plus stores with totalRevenue)
   *   - anyone else:   SELECT id, name FROM store WHERE franchiseId=?
   * It asks for one extra row to learn whether there is a next page (`more`), then trims it off.
   * `*` in the filter becomes SQL's `%` wildcard, so `*pizza*` matches names containing "pizza".
   *
   * NOTE: from HTTP, page and limit arrive as strings, so `limit + 1` joins text: "3" + 1 is "31".
   * NOTE: limit and offset are pasted into the SQL string rather than using placeholders.
   * @param {object} [authUser] - req.user, or undefined when not logged in
   * @returns {Promise<[object[], boolean]>} `[franchises, more]`
   */
  async getFranchises(authUser, page = 0, limit = 10, nameFilter = '*') {
    const connection = await this.getConnection();

    const offset = page * limit;
    nameFilter = nameFilter.replace(/\*/g, '%');

    try {
      let franchises = await this.query(connection, `SELECT id, name FROM franchise WHERE name LIKE ? LIMIT ${limit + 1} OFFSET ${offset}`, [nameFilter]);

      const more = franchises.length > limit;
      if (more) {
        franchises = franchises.slice(0, limit);
      }

      for (const franchise of franchises) {
        if (authUser?.isRole(Role.Admin)) {
          await this.getFranchise(franchise);
        } else {
          franchise.stores = await this.query(connection, `SELECT id, name FROM store WHERE franchiseId=?`, [franchise.id]);
        }
      }
      return [franchises, more];
    } finally {
      connection.end();
    }
  }

  /**
   * The franchises a user is a franchisee of, fully filled in. Used by the franchise dashboard.
   * SQL: SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?
   *      (stops here and returns [] if there are none, which is the case for a plain diner)
   *      SELECT id, name FROM franchise WHERE id in (...)
   *      getFranchise for each (admins, stores with revenue)
   * Reads roles from the database, not the token, so a franchise created after login still shows up.
   * @returns {Promise<object[]>}
   */
  async getUserFranchises(userId) {
    const connection = await this.getConnection();
    try {
      let franchiseIds = await this.query(connection, `SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?`, [userId]);
      if (franchiseIds.length === 0) {
        return [];
      }

      franchiseIds = franchiseIds.map((v) => v.objectId);
      const franchises = await this.query(connection, `SELECT id, name FROM franchise WHERE id in (${franchiseIds.join(',')})`);
      for (const franchise of franchises) {
        await this.getFranchise(franchise);
      }
      return franchises;
    } finally {
      connection.end();
    }
  }

  /**
   * Fills in a franchise object's `admins` and `stores` (each store with its total revenue). Modifies and
   * returns the object passed in, which only needs an `id`.
   * SQL: SELECT u.id, u.name, u.email FROM userRole AS ur JOIN user AS u ON u.id=ur.userId WHERE ur.objectId=? AND ur.role='franchisee'
   *      SELECT s.id, s.name, COALESCE(SUM(oi.price), 0) AS totalRevenue FROM dinerOrder AS do JOIN orderItem AS oi ON do.id=oi.orderId RIGHT JOIN store AS s ON s.id=do.storeId WHERE s.franchiseId=? GROUP BY s.id
   * How the revenue query works: join orders to their items, then RIGHT JOIN stores so a store with no orders
   * still appears; SUM adds up item prices per store, and COALESCE turns "no orders" (NULL) into 0.
   * @param {{id: number}} franchise
   * @returns {Promise<object>} the same object, always (never null, even when the id doesn't exist)
   */
  async getFranchise(franchise) {
    const connection = await this.getConnection();
    try {
      franchise.admins = await this.query(connection, `SELECT u.id, u.name, u.email FROM userRole AS ur JOIN user AS u ON u.id=ur.userId WHERE ur.objectId=? AND ur.role='franchisee'`, [franchise.id]);

      franchise.stores = await this.query(connection, `SELECT s.id, s.name, COALESCE(SUM(oi.price), 0) AS totalRevenue FROM dinerOrder AS do JOIN orderItem AS oi ON do.id=oi.orderId RIGHT JOIN store AS s ON s.id=do.storeId WHERE s.franchiseId=? GROUP BY s.id`, [franchise.id]);

      return franchise;
    } finally {
      connection.end();
    }
  }

  /**
   * Adds a store to a franchise.
   * SQL: INSERT INTO store (franchiseId, name) VALUES (?, ?)
   * @param {number} franchiseId
   * @param {{name: string}} store
   * @returns {Promise<{id: number, franchiseId: number, name: string}>}
   */
  async createStore(franchiseId, store) {
    const connection = await this.getConnection();
    try {
      const insertResult = await this.query(connection, `INSERT INTO store (franchiseId, name) VALUES (?, ?)`, [franchiseId, store.name]);
      return { id: insertResult.insertId, franchiseId, name: store.name };
    } finally {
      connection.end();
    }
  }

  /**
   * Deletes a store. Requiring the franchiseId too means you can't delete another franchise's store by id alone.
   * SQL: DELETE FROM store WHERE franchiseId=? AND id=?
   */
  async deleteStore(franchiseId, storeId) {
    const connection = await this.getConnection();
    try {
      await this.query(connection, `DELETE FROM store WHERE franchiseId=? AND id=?`, [franchiseId, storeId]);
    } finally {
      connection.end();
    }
  }

  /**
   * Rows to skip for a 1-based page: page 1 -> 0, page 2 -> listPerPage, and so on.
   * (`[listPerPage]` is an array, but JavaScript converts a one-element array to its number when multiplying.)
   */
  getOffset(currentPage = 1, listPerPage) {
    return (currentPage - 1) * [listPerPage];
  }

  /**
   * Returns the signature, the third dot-separated part of a JWT (`header.payload.signature`).
   * Only the signature is stored in the auth table: it is unique per token and much shorter than the whole thing.
   * @returns {string} the signature, or '' if the string isn't shaped like a JWT
   */
  getTokenSignature(token) {
    const parts = token.split('.');
    if (parts.length > 2) {
      return parts[2];
    }
    return '';
  }

  /**
   * Runs one SQL statement as a prepared statement (the `?`s are filled from params) and returns just the
   * result: rows for a SELECT, or an info object with `insertId` for an INSERT.
   */
  async query(connection, sql, params) {
    const [results] = await connection.execute(sql, params);
    return results;
  }

  /**
   * Finds the id of the row in `table` whose `key` column equals `value`.
   * SQL: SELECT id FROM <table> WHERE <key>=?
   * @throws {Error} 'No ID found' when there is no such row
   */
  async getID(connection, key, value, table) {
    const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE ${key}=?`, [value]);
    if (rows.length > 0) {
      return rows[0].id;
    }
    throw new Error('No ID found');
  }

  /** Waits for initialization, then opens a new connection with the pizza database selected. Callers must end() it. */
  async getConnection() {
    // Make sure the database is initialized before trying to get a connection.
    await this.initialized;
    return this._getConnection();
  }

  /**
   * Opens a raw MySQL connection using config.db.connection.
   * `decimalNumbers: true` makes DECIMAL prices come back as numbers instead of strings.
   * @param {boolean} [setUse=true] - select the pizza database; false during init, before the database exists
   */
  async _getConnection(setUse = true) {
    const connection = await mysql.createConnection({
      host: config.db.connection.host,
      user: config.db.connection.user,
      password: config.db.connection.password,
      connectTimeout: config.db.connection.connectTimeout,
      decimalNumbers: true,
    });
    if (setUse) {
      await connection.query(`USE ${config.db.connection.database}`);
    }
    return connection;
  }

  /**
   * Runs once at startup: creates the database and tables if needed, and on the very first run adds the
   * default admin (a@jwt.com / admin).
   * Errors are logged, not thrown, so the server still starts. Queries will fail later if MySQL is down.
   * NOTE: `this.addUser(defaultAdmin)` is not awaited, so the admin may not exist yet when the first request
   * arrives. This is why the seed script waits for the admin before seeding.
   */
  async initializeDatabase() {
    try {
      const connection = await this._getConnection(false);
      try {
        const dbExists = await this.checkDatabaseExists(connection);
        console.log(dbExists ? 'Database exists' : 'Database does not exist, creating it');

        await connection.query(`CREATE DATABASE IF NOT EXISTS ${config.db.connection.database}`);
        await connection.query(`USE ${config.db.connection.database}`);

        if (!dbExists) {
          console.log('Successfully created database');
        }

        for (const statement of dbModel.tableCreateStatements) {
          await connection.query(statement);
        }

        if (!dbExists) {
          const defaultAdmin = { name: '常用名字', email: 'a@jwt.com', password: 'admin', roles: [{ role: Role.Admin }] };
          this.addUser(defaultAdmin);
        }
      } finally {
        connection.end();
      }
    } catch (err) {
      console.error(JSON.stringify({ message: 'Error initializing database', exception: err.message, connection: config.db.connection }));
    }
  }

  /**
   * Does the pizza database exist yet?
   * SQL: SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?
   * @returns {Promise<boolean>}
   */
  async checkDatabaseExists(connection) {
    const [rows] = await connection.execute(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`, [config.db.connection.database]);
    return rows.length > 0;
  }
}

/** The one shared DB instance. Requiring this file anywhere gets this same object. */
const db = new DB();
module.exports = { Role, DB: db };
