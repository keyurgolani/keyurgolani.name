import { errorCode, login } from '../harness/security-suite';
import { expect, failureSources, test } from './fixtures';

// The control for security.spec.ts's hop count test (#2, studio-9): the same
// proxy, which appends one entry to X-Forwarded-For, in front of an app
// that trusts two. The second entry from the right is then one the client
// wrote, which is what docs/deployment.md warns a count set too high does,
// so the suite can tell a right count from a wrong one.
test.use({ proxyOptions: { hops: 2 } });

test('the control: a hop count one too high takes what the client wrote as the source, as docs/deployment.md warns', async ({
  target,
}) => {
  expect(target.hops).toBe(2);
  // Every attempt claims another address, and with one hop too many the
  // server believes it, so none is ever blocked.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const answer = await login(target, {
      password: 'not the password',
      headers: { 'x-forwarded-for': `203.0.113.${attempt * 40}` },
    });
    expect(errorCode(answer), `attempt ${attempt}`).toBe('credentials_rejected');
  }
  expect((await failureSources(target)).at(-1)).toBe('203.0.113.0/24');
});
