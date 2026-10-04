import { describe, expect, it } from 'vitest';
import { subscribeProblem } from './push.ts';

describe('push sign-up', () => {
  it('turns the browser’s refusal into what to do about it', () => {
    const chrome = Object.assign(new Error('Registration failed - push service error'), {
      name: 'AbortError',
    });
    expect(subscribeProblem(chrome, true)).toMatch(/Use Google services for push messaging/);
    expect(subscribeProblem(chrome, false)).toMatch(
      /refused to sign it up\. It said: “Registration failed - push service error”\. A VPN/,
    );
    const blocked = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    expect(subscribeProblem(blocked, false)).toMatch(/Notifications are blocked/);
  });
});
