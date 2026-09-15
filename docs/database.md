# The database

MySQL, one database named `pizza`. The tables are defined in `src/database/dbModel.js`, and every query lives in
`src/database/database.js`.

## Tables and how they connect

Solid lines are real foreign keys (MySQL enforces them). Dashed lines are links the code relies on but the database
doesn't check.

```mermaid
erDiagram
  user ||--o{ userRole : "has roles (FK)"
  user ||..o{ auth : "logged-in tokens"
  user ||..o{ dinerOrder : "places (dinerId)"
  franchise ||--o{ store : "owns (FK)"
  franchise ||..o{ userRole : "objectId, franchisees only"
  franchise ||..o{ dinerOrder : "franchiseId"
  store ||..o{ dinerOrder : "sold at (storeId)"
  dinerOrder ||--|{ orderItem : "contains (FK)"
  menu ||..o{ orderItem : "copied from (menuId)"

  user {
    int id PK
    varchar name
    varchar email
    varchar password "bcrypt hash"
  }
  userRole {
    int id PK
    int userId FK
    varchar role "diner, franchisee, admin"
    int objectId "franchise id, or 0"
  }
  auth {
    varchar token PK "JWT signature only"
    int userId
  }
  franchise {
    int id PK
    varchar name "unique"
  }
  store {
    int id PK
    int franchiseId FK
    varchar name
  }
  menu {
    int id PK
    varchar title
    varchar image
    decimal price "e.g. 0.0038"
    text description
  }
  dinerOrder {
    int id PK
    int dinerId
    int franchiseId
    int storeId
    datetime date
  }
  orderItem {
    int id PK
    int orderId FK
    int menuId
    varchar description
    decimal price
  }
```

## The two columns that surprise people

**`userRole.objectId` means different things depending on `role`.** A franchisee row stores *which franchise*
they run. Diner and admin rows store `0`, because those roles don't belong to anything.

| userId | role | objectId | Meaning |
| --- | --- | --- | --- |
| 1 | admin | 0 | user 1 is an admin |
| 3 | diner | 0 | user 3 is a diner |
| 3 | franchisee | 2 | user 3 also runs franchise 2 |

**`auth.token` holds only the third part of the JWT.** A JWT looks like `header.payload.signature`.
`getTokenSignature` stores just the signature: it is unique to that token and much shorter. A row existing means
"this token is still logged in"; logout deletes the row.

**`orderItem` copies `description` and `price`** rather than only pointing at the menu, so an old order keeps the
price it was sold at even if the menu changes later.

## Which code touches which table

R = reads, W = writes (INSERT/UPDATE/DELETE).

| `DB` method | Called by | user | userRole | auth | franchise | store | menu | dinerOrder | orderItem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `addUser` | register, `init.js`, first startup | W | W | | R* | | | | |
| `getUser` | login | R | R | | | | | | |
| `updateUser` | PUT /api/user/:id | W, R | R | | | | | | |
| `loginUser` | register, login, update user | | | W | | | | | |
| `isLoggedIn` | `setAuthUser`, every request with a token | | | R | | | | | |
| `logoutUser` | logout | | | W | | | | | |
| `getMenu` / `addMenuItem` | menu endpoints | | | | | | R / W | | |
| `addDinerOrder` | POST /api/order | | | | | | R | W | W |
| `getOrders` | GET /api/order | | | | | | | R | R |
| `getFranchises` | GET /api/franchise | R† | R† | | R | R | | R† | R† |
| `getUserFranchises` | GET /api/franchise/:userId | R | R | | R | R | | R | R |
| `getFranchise` | the two above, store routes | R | R | | | R | | R | R |
| `createFranchise` | POST /api/franchise | R | W | | W | | | | |
| `deleteFranchise` | DELETE /api/franchise/:id | | W | | W | W | | | |
| `createStore` / `deleteStore` | store routes | | | | | W | | | |

\* only when adding a franchisee role · † only when the caller is an admin (through `getFranchise`)

## How one query runs

There is no connection pool: every method opens its own connection and closes it.

```mermaid
sequenceDiagram
  participant R as a router
  participant DB as DB method
  participant I as this.initialized
  participant M as MySQL
  R->>DB: await DB.getMenu()
  DB->>I: await: wait until tables exist
  DB->>M: mysql.createConnection(config.db.connection)
  DB->>M: USE pizza
  DB->>M: execute(sql, params)  the ? marks are filled safely
  M-->>DB: rows
  DB->>M: connection.end()  in finally, even after an error
  DB-->>R: rows
```

## What happens at startup

`database.js` creates its single `DB` object the first time any file `require`s it, and the constructor starts
`initializeDatabase()`:

```mermaid
flowchart TD
  start["new DB()"]:::be --> conn["connect without choosing a database"]:::be
  conn --> exists{"does database pizza exist?"}:::db
  exists --> create["CREATE DATABASE IF NOT EXISTS pizza<br/>USE pizza"]:::db
  create --> tables["run every CREATE TABLE IF NOT EXISTS<br/>from dbModel.js"]:::db
  tables --> first{"was this the first run?"}
  first -- "yes" --> admin["addUser: a@jwt.com / admin<br/>(not awaited)"]:::db
  first -- "no" --> done["done"]
  admin --> done
  conn -. "MySQL down" .-> log["log the error. Server still starts, and queries fail later."]
  classDef be fill:#ccfbf1,stroke:#0f766e,color:#134e4a
  classDef db fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
```

Because the default admin is added without `await`, a script that logs in immediately after a fresh start can fail.
That's why `scripts/generatePizzaData.sh` retries until the admin exists.

## Where values are pasted into SQL

`?` placeholders keep input from changing a query. These spots build SQL with `${...}` instead, so they're worth
knowing about for security testing:

| Method | What's pasted in | Where it comes from |
| --- | --- | --- |
| `updateUser` | name, email, password hash, userId | the request body. **Injectable.** |
| `getFranchises` | `limit + 1`, `offset` | the URL query string |
| `getOrders` | `offset`, `listPerPage` | the page number in the URL, and config |
| `getUserFranchises` | franchise ids | the database's own values |
| `getID` | table and column names | fixed strings in the code |
