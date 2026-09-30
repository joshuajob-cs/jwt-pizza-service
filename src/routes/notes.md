# Notes on the tests

What each line does, in my own words, so I can rebuild these without help.

## orderRouter.test.js

```js
const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ jwt: 'factory-jwt', reportUrl: 'factory-report' }) });
```

jest.spyOn() allows jest to track this function, how many times the route called this function in this test, what parameters the route gave the call, and how it returned
