/**
 * @fileoverview Sends log events to Grafana Cloud (Loki).
 *
 * Every event carries three labels Grafana can filter on: component (which environment, from
 * config.logging.source), level (info/warn/error), and type (http, db, factory, ...).
 *
 * The requesting user goes in the log line, not a label: one label value per user would make a stream per user.
 * Code like DB.query never sees req, so httpLogger saves req in AsyncLocalStorage for the rest of the request,
 * and log() reads the user back from there.
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config');

// Holds the current request's req object. Every await started inside httpLogger's run() sees the same one.
const currentRequest = new AsyncLocalStorage();

class Logger {
  httpLogger = (req, res, next) => {
    const send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: JSON.stringify(req.body),
        resBody: JSON.stringify(resBody),
      };
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);
      res.send = send;
      return res.send(resBody);
    };
    // req, not req.user: setAuthUser sets req.user later in this same request.
    currentRequest.run(req, next);
  };

  log(level, type, logData) {
    const labels = { component: config.logging.source, level, type };
    const userId = currentRequest.getStore()?.user?.id;
    const values = [this.nowString(), this.sanitize({ userId, ...logData })];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    // Returned so a caller that must wait for the send (the crash handler in index.js) can await it.
    return this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) {
      return 'error';
    }
    if (statusCode >= 400) {
      return 'warn';
    }
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  sanitize(logData) {
    logData = JSON.stringify(logData);
    return logData.replace(/\\"password\\":\s*\\"[^"]*\\"/g, '\\"password\\": \\"*****\\"');
  }

  async sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    try {
      const res = await fetch(config.logging.endpointUrl, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`,
        },
      });
      if (!res.ok) {
        console.error(`Failed to send log to Grafana: ${await res.text()}`);
      }
    } catch (error) {
      console.error('Error sending log to Grafana:', error);
    }
  }
}
module.exports = new Logger();
