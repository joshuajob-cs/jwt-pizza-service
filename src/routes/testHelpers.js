/**
 * @fileoverview Setup helpers shared by the router tests.
 *
 * Rule: tests set up their data through the API, like a real client would. The one exception is
 * createAdminUser, because the API has no way to make an admin, so it writes to the database directly.
 */
const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

/** A random 10-character name, so tests never collide with each other or with data from earlier runs. */
function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

/** Adds an admin straight to the database. Returns the user with its id and the plain-text password, ready to log in. */
async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

/** Registers a new diner through the API. Returns `{ user, token }`; user has id, name, and email. */
async function registerUser() {
  const newUser = { name: randomName(), email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  return registerRes.body;
}

module.exports = { randomName, createAdminUser, registerUser };
