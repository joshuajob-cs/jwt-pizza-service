/**
 * @fileoverview The CREATE TABLE statements for the JWT Pizza database. DB.initializeDatabase runs them in
 * order on every startup; `IF NOT EXISTS` makes that safe to repeat.
 */
const tableCreateStatements = [
  // auth: one row per logged-in token. `token` holds only the JWT's signature part (see DB.getTokenSignature).
  `CREATE TABLE IF NOT EXISTS auth (
    token VARCHAR(512) PRIMARY KEY,
    userId INT NOT NULL
  )`,

  // user: everyone who has an account. `password` is a bcrypt hash, never the real password.
  `CREATE TABLE IF NOT EXISTS user (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL
  )`,

  // menu: the pizzas you can order. `price` is a tiny decimal (e.g. 0.0038), hence DECIMAL(10, 8).
  `CREATE TABLE IF NOT EXISTS menu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    image VARCHAR(1024) NOT NULL,
    price DECIMAL(10, 8) NOT NULL,
    description TEXT NOT NULL
  )`,

  // franchise: a business that owns stores. Names must be unique.
  `CREATE TABLE IF NOT EXISTS franchise (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE
  )`,

  // store: one location belonging to a franchise.
  `CREATE TABLE IF NOT EXISTS store (
    id INT AUTO_INCREMENT PRIMARY KEY,
    franchiseId INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    FOREIGN KEY (franchiseId) REFERENCES franchise(id)
  )`,

  // userRole: which roles each user has. A user can have several rows.
  // `objectId` is what the role applies to: the franchise id for a franchisee, 0 for diner and admin.
  `CREATE TABLE IF NOT EXISTS userRole (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    role VARCHAR(255) NOT NULL,
    objectId INT NOT NULL,
    FOREIGN KEY (userId) REFERENCES user(id),
    INDEX (objectId)
  )`,

  // dinerOrder: one order, by one diner, from one store. The pizzas in it are in orderItem.
  `CREATE TABLE IF NOT EXISTS dinerOrder (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dinerId INT NOT NULL,
    franchiseId INT NOT NULL,
    storeId INT NOT NULL,
    date DATETIME NOT NULL,
    INDEX (dinerId),
    INDEX (franchiseId),
    INDEX (storeId)
  )`,

  // orderItem: one pizza in an order, with the description and price copied in at the time it was ordered.
  `CREATE TABLE IF NOT EXISTS orderItem (
    id INT AUTO_INCREMENT PRIMARY KEY,
    orderId INT NOT NULL,
    menuId INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    price DECIMAL(10, 8) NOT NULL,
    FOREIGN KEY (orderId) REFERENCES dinerOrder(id),
    INDEX (menuId)
  )`,
];

module.exports = { tableCreateStatements };
