# CLAUDE.md — jwt-pizza-service

Backend REST service for **JWT Pizza**, the mastery project for **BYU CS329 (QA & DevOps)**.
Express + MySQL. Tracks users, franchises, stores, menu, and orders; forwards fulfilled orders
to the external **JWT Pizza Factory**, which mints the actual pizza JWTs.

> **This file is committed and public — project context only.** Anything personal (machine paths,
> my git remotes, local setup state, secrets) lives outside this repo: in an untracked `CLAUDE.md`
> in the parent workspace folder, and in a gitignored `CLAUDE.local.md` here. Claude Code loads
> all three; only this one is pushed. **Never add identifying details to this file.**

**For any course question** — assignments, grading, deliverable requirements, AWS/Grafana steps —
read the local workspace notes and the course instruction repo they point at (a clone of
<https://github.com/devops329/devops>, outside this repo). Don't guess from memory.

Instruction docs most specific to this repo: `instruction/jwtPizzaService/`,
`instruction/unitTestingJwtPizzaService/`, `instruction/jwtPizzaData/` (curl seed data),
`instruction/jwtPizzaFactory/`, `instruction/jwtPizzaServiceContainer/`,
`instruction/jwtPizzaServiceInfrastructureAutomation/`, `instruction/serviceTesting/`,
`instruction/jestBasics/`, `instruction/jestAdvanced/`, `instruction/coverage/`, `instruction/lint/`.

Deliverables that land here: **3** (unit testing), **7** (backend deployment), **8** (metrics),
**9** (logging), **10** (load testing); **1**, **5**, **11**, **12** span both repos.

---

## Repo layout

Small — 18 tracked files, all logic under [src/](src/).

```
src/
  index.js            entry point; port = argv[2] || 3000
  service.js          Express app: CORS, /api mount, /api/docs, 404, error handler
  endpointHelper.js   asyncHandler + StatusCodeError
  version.json        {"version": "..."} — CI stamps this (deliverable 3)
  config.js           GITIGNORED — you must create it (template below)
  init.js             CLI: node init.js <name> <email> <password> → creates an admin
  model/model.js      Role enum: diner | franchisee | admin
  database/
    database.js       DB class — the entire data layer; exports singleton `DB` + `Role`
    dbModel.js        CREATE TABLE statements
  routes/
    authRouter.js     register/login/logout + setAuthUser + authenticateToken
    userRouter.js     /me, update user (delete + list are stubs)
    orderRouter.js    menu, get/create orders, calls the Factory
    franchiseRouter.js franchises + stores CRUD
deployService.sh      scp/ssh deploy to an EC2 host running pm2 (deliverable 1/2 era)
```

### Architecture notes

- **Routers self-document.** Each router has a `.docs` array; `service.js` concatenates them for
  `GET /api/docs`. **If you add or change an endpoint, update that router's `docs` array too.**
- **Errors** flow through `asyncHandler` → the terminal error middleware in
  [src/service.js:50-54](src/service.js#L50-L54), which returns `{message, stack}` with
  `err.statusCode ?? 500`. Throw `StatusCodeError(msg, code)` for expected failures.
- **Auth**: `setAuthUser` runs as global middleware. It validates the JWT *and* checks the `auth`
  table (only the **signature segment** of the token is stored — see `getTokenSignature`). Then
  `authRouter.authenticateToken` gates individual routes. `req.user.isRole(role)` is attached at
  auth time and only exists on an authenticated request.
- **DB singleton**: `database.js` instantiates `new DB()` at require time, which kicks off
  `initializeDatabase()` (creates DB + tables, and seeds the default admin on first run).
  Every method opens its own connection and `connection.end()`s in a `finally`. There is no pool.
- **Factory call**: `POST /api/order` posts to `${config.factory.url}/api/order` with the factory
  API key. Responses carry `followLinkToEndChaos` — that's the chaos-testing hook (deliverable 11).

### Endpoint map

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/` | — | welcome + version |
| GET | `/api/docs` | — | generated from router `.docs` |
| POST | `/api/auth` | — | register (always role `diner`) |
| PUT | `/api/auth` | — | login |
| DELETE | `/api/auth` | ✓ | logout |
| GET | `/api/user/me` | ✓ | returns `req.user` |
| PUT | `/api/user/:userId` | ✓ | self or admin; re-issues token |
| DELETE | `/api/user/:userId` | ✓ | **stub — "not implemented"** |
| GET | `/api/user` | ✓ | **stub — "not implemented"** |
| GET | `/api/order/menu` | — | |
| PUT | `/api/order/menu` | ✓ admin | |
| GET | `/api/order` | ✓ | paginated by `config.db.listPerPage` |
| POST | `/api/order` | ✓ | calls the Factory |
| GET | `/api/franchise` | — | `?page&limit&name` (`*` → SQL `%`) |
| GET | `/api/franchise/:userId` | ✓ | self or admin, else `[]` |
| POST | `/api/franchise` | ✓ admin | |
| DELETE | `/api/franchise/:franchiseId` | **none** | see Known issues |
| POST | `/api/franchise/:franchiseId/store` | ✓ admin or franchise admin | |
| DELETE | `/api/franchise/:franchiseId/store/:storeId` | ✓ admin or franchise admin | |

### Schema (`src/database/dbModel.js`)

`auth(token PK, userId)` · `user(id, name, email, password)` ·
`menu(id, title, image, price DECIMAL(10,8), description)` · `franchise(id, name UNIQUE)` ·
`store(id, franchiseId→franchise, name)` · `userRole(id, userId→user, role, objectId)` ·
`dinerOrder(id, dinerId, franchiseId, storeId, date)` · `orderItem(id, orderId→dinerOrder, menuId, description, price)`

`userRole.objectId` is `0` for diner/admin and the **franchiseId** for franchisees.
Prices are tiny decimals (bitcoin-ish, e.g. `0.0038`); `decimalNumbers: true` on the connection.

---

## Working in this repo

```sh
npm install
# create src/config.js (gitignored) — see template below
# start MySQL 8 locally
npm start                                    # === cd src && node index.js  → port 3000
node src/init.js <name> <email> <password>   # optional extra admin
curl localhost:3000/api/docs
```

`src/config.js` template — **placeholders only, never commit real values**:

```js
module.exports = {
  jwtSecret: 'yourjwtsecrethere',
  db: {
    connection: { host: '127.0.0.1', user: 'root', password: '...', database: 'pizza', connectTimeout: 60000 },
    listPerPage: 10,
  },
  factory: { url: 'https://pizza-factory.cs329.click', apiKey: 'yourapikeyhere' },
};
```

The factory API key comes from your account at <https://pizza-factory.cs329.click>.
Seed admin after the first run: `a@jwt.com` / `admin`. The course's `instruction/jwtPizzaData/`
has curl scripts to create the franchisee, stores, and menu items.

### Conventions

- **CommonJS** (`require` / `module.exports`), Node 24, no TypeScript, no build step.
- Prettier-ish formatting already in the tree: 2-space indent, single quotes, semicolons,
  **very wide lines** (~200 cols — the `docs` arrays and SQL strings stay on one line). Match it.
- No test framework, no linter, and no CI workflows are set up yet — **deliverable 3 adds Jest,
  coverage, ESLint, and `.github/workflows/`.** Don't assume `npm test` exists until then.
- `config.js`, `node_modules`, `coverage`, `dist`, and the `CLAUDE*.md` notes are gitignored.
  **Never commit secrets** — deliverable 3 explicitly grades keeping the factory key and DB
  password out of the repo (they go in GitHub repo secrets and get written into `config.js` by CI).

### Git

Branch `main`. This is a student fork of `devops329/jwt-pizza-service` (`upstream`). Sync from
upstream via GitHub's **"Sync fork"** — **never "Discard commits"**, that would drop the tests and
CI work.

### Known issues / intentional weaknesses

These are largely *deliberate* — the course has you find and fix them in testing, TDD, and
penetration-testing deliverables. Don't silently "fix" them unless the task calls for it, but do
flag them.

1. **`DELETE /api/franchise/:franchiseId` has no `authenticateToken` and no admin check** —
   [franchiseRouter.js:97-104](src/routes/franchiseRouter.js#L97-L104). Anyone can delete a franchise.
2. **SQL injection in `DB.updateUser`** — [database.js:78-100](src/database/database.js#L78-L100)
   builds the `UPDATE` with string interpolation instead of placeholders.
3. `DB.updateUser` returns `this.getUser(email, password)` — breaks when the caller sends only a
   name, or a password without an email.
4. **Stack traces leak to clients** from the error handler in `service.js`.
5. `DELETE /api/user/:userId` and `GET /api/user` are stubs (deliverable 5 / TDD builds these).
6. `getFranchises` interpolates `limit`/`offset` straight into the SQL string.
7. `initializeDatabase` does not `await this.addUser(defaultAdmin)`.
8. `version.json` ships as `00010101.010101` — a placeholder; CI stamps the real value.

---

## Related projects

- **[../jwt-pizza/](../jwt-pizza/)** — the React/Vite/Tailwind frontend, with its own `CLAUDE.md`
  covering the `navItems` routing hub, the `pizzaService` seam, and the full list of backend calls
  it makes. Its `src/service/httpPizzaService.ts` is the authoritative list of which endpoints here
  are actually consumed. Its `notes.md` is the blank deliverable 1 worksheet, which needs facts
  from *this* repo (endpoints + SQL) to fill in.
- **JWT Pizza Factory** — external service at `https://pizza-factory.cs329.click`; also the
  source of the coverage badge in [README.md](README.md).
- **Course content** — <https://github.com/devops329/devops>, cloned locally alongside this repo.
