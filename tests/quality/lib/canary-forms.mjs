// The forms a credential takes in the quality runs' artifacts (#11, Slice 1,
// item 11), each with the scrub rule (lib/artifacts.mjs's RULES) that takes
// it out. artifacts.test.mjs plants the canary in each and shows the scrub
// takes it out with every rule, and leaves it with that one rule removed;
// quality:meta's canary cases plant every form in a trace, a log, and
// summary.json. A form here is one a real run writes: a trace's network log
// and call log, the app's RSC payload, a server log, and an error that
// summary.json keeps.

/** @type {Readonly<Record<string, readonly ((canary: string) => string)[]>>} */
export const CANARY_FORMS = Object.freeze({
  'header-pair': [
    // A trace's request headers.
    (canary) => `{"headers":[{"name":"Cookie","value":"quality_canary=${canary}"}]}`,
    (canary) => `{"name":"authorization","value":"Bearer ${canary}"}`,
  ],
  field: [
    (canary) => `{"authorization":"Bearer ${canary}","accept":"*/*"}`,
    // The app's RSC payload, its JSON inside a JSON string.
    (canary) => `self.__next_f.push([1,"{\\"csrfToken\\":\\"${canary}\\"}"])`,
  ],
  'header-line': [
    // A server log, or an HTTP dump.
    (canary) => `GET / 200\nauthorization: Bearer ${canary}\naccept: */*\n`,
    // A Playwright call log line, kept in a JSON string in trace.trace.
    (canary) => `{"type":"log","message":"  cookie: quality_canary=${canary}"}`,
    (canary) => `{"type":"log","message":"  x-csrf-token: ${canary}"}`,
    // A header list in an error message.
    (canary) => `Request headers:\n  - authorization: Bearer ${canary}\n`,
    // An error with headers in it, as summary.json keeps it, JSON-escaped.
    (canary) =>
      JSON.stringify({
        errors: [`request failed\n  authorization: Bearer ${canary}\n  accept: */*`],
      }),
  ],
  'cookie-list': [
    // A trace's addCookies call.
    (canary) =>
      `{"method":"addCookies","params":{"cookies":[{"name":"quality_canary","value":"${canary}","url":"http://127.0.0.1"}]}}`,
  ],
});

/** A credential in a form no rule knows, which the scrub must leave for the scan to find. */
export const UNKNOWN_FORM = (canary) => `x-api-key: ${canary}\n`;

/** Every form, one per line, holding `canary`. */
export const everyForm = (canary) =>
  Object.values(CANARY_FORMS)
    .flat()
    .map((form) => form(canary))
    .join('\n');
