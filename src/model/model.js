/**
 * @fileoverview The three user roles, as the strings stored in the userRole.role column.
 */

/**
 * User roles.
 * - Diner: anyone who registers; can order pizza.
 * - Franchisee: runs a franchise; the userRole row's objectId is that franchise's id.
 * - Admin: runs JWT Pizza; can create/close franchises and add menu items.
 * @enum {string}
 */
const Role = {
  Diner: 'diner',
  Franchisee: 'franchisee',
  Admin: 'admin',
};

module.exports = { Role };
