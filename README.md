# 🍕 jwt-pizza-service

![Coverage badge](https://pizza-factory.cs329.click/api/badge/accountId/jwtpizzaservicecoverage)

Backend service for making JWT pizzas. This service tracks users and franchises and orders pizzas. All order requests are passed to the JWT Pizza Factory where the pizzas are made.

JWTs are used for authentication objects.

## Deployment

In order for the server to work correctly it must be configured by providing a `config.js` file.

```js
module.exports = {
  // Your JWT secret can be any random string you would like. It just needs to be secret.
  jwtSecret: "yourjwtsecrethere",
  db: {
    connection: {
      host: "127.0.0.1",
      user: "root",
      password: "yourpasswordhere",
      database: "pizza",
      connectTimeout: 60000,
    },
    listPerPage: 10,
  },
  factory: {
    url: "https://pizza-factory.cs329.click",
    apiKey: "yourapikeyhere",
  },
};
```

## Running locally

`scripts/dev.sh` starts the whole app with one command: the backend on port 3000, then the [jwt-pizza](https://github.com/devops329/jwt-pizza) frontend on port 5173. Output from each is labeled `[back]` or `[front]`, and Ctrl+C stops both.

```sh
./scripts/dev.sh           # start both, keep existing data
./scripts/dev.sh --reset   # drop the database and reseed it with sample users, menu, and a franchise
```

It expects the frontend repo to be cloned next to this one (`../jwt-pizza`), MySQL running on port 3306, and `src/config.js` in place. It checks all of these before starting and says what is missing. `--reset` also needs [jq](https://jqlang.github.io/jq/).

Sample logins after `--reset`: `a@jwt.com` / `admin`, `d@jwt.com` / `diner`, `f@jwt.com` / `franchisee`.

## Endpoints

You can get the documentation for all endpoints by making the following request.

```sh
curl localhost:3000/api/docs
```

## Development notes

Install the required packages.

```sh
npm install express jsonwebtoken mysql2 bcrypt
```

Nodemon is assumed to be installed globally so that you can have hot reloading when debugging.

```sh
npm -g install nodemon
```
