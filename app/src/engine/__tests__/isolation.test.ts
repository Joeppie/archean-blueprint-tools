import { describe, expect, it } from 'vitest';

import { shouldRegisterIsolationSw } from '../isolation';

// THE ISOLATION-SW BOOT LAW (v1.13.29): the header-forging service worker
// (public/sw.js, registered by main.tsx) may register ONLY on a non-
// isolated, unflagged load in a browser with SW support — every other
// combination must stay byte-identical to the pre-SW behaviour (the SAB
// gate's fallback path is untouched; the registration effect + reload
// itself is e2e-pinned in e2e/isolation.spec.ts).
describe('THE ISOLATION-SW BOOT LAW (shouldRegisterIsolationSw)', () => {
  const T = { isolated: true, flagged: true, hasSW: true };
  it('registers on the first non-isolated load of a tab (the Pages case)', () => {
    expect(shouldRegisterIsolationSw({ isolated: false, flagged: false, hasSW: true })).toBe(true);
  });
  it('an already-isolated origin never registers (dev/preview send COOP/COEP)', () => {
    expect(shouldRegisterIsolationSw({ isolated: true, flagged: false, hasSW: true })).toBe(false);
  });
  it('the one-shot flag wins — no reload storm when the SW never activates', () => {
    expect(shouldRegisterIsolationSw({ isolated: false, flagged: true, hasSW: true })).toBe(false);
  });
  it('a browser without service workers keeps today\'s main-thread pump', () => {
    expect(shouldRegisterIsolationSw({ isolated: false, flagged: false, hasSW: false })).toBe(false);
    expect(shouldRegisterIsolationSw(T)).toBe(false);
  });
  it('the steady state (second load in a tab: isolated + flagged) is a no-op', () => {
    expect(shouldRegisterIsolationSw(T)).toBe(false);
  });
});
