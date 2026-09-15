/**
 * @fileoverview Entry point: starts the Express app from service.js listening on a port.
 *
 * Run with `npm start` (which is `cd src && node index.js`). The port comes from the first
 * command-line argument, e.g. `node index.js 4000`, and defaults to 3000.
 */
const app = require('./service.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
