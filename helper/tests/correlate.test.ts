import { describe, expect, test } from 'vitest';
import { findRelated, looksDone, normalizeAmount, type TaskProfile } from '../src/tasks/correlate.js';

const pge: TaskProfile = {
  id: 1,
  kind: 'pay',
  title: 'Pay PG&E',
  amount: '$84.20',
  text: 'Your PG&E bill is ready. Amount due: $84.20',
};
const lease: TaskProfile = {
  id: 2,
  kind: 'sign',
  title: 'Sign: Lease renewal 2027',
  amount: null,
  text: 'Please DocuSign: Lease renewal 2027',
};
const sharma: TaskProfile = {
  id: 3,
  kind: 'pay',
  title: 'Pay Sharma ji for the plumber',
  amount: '₹2,400',
  text: 'Please pay ₹2,400 to Sharma ji for the plumber',
};
const profiles = [pge, lease, sharma];

describe('normalizeAmount', () => {
  test('compares amounts by value, not formatting', () => {
    expect(normalizeAmount('$84.20')).toBe('84.2');
    expect(normalizeAmount('USD 84.20')).toBe('84.2');
    expect(normalizeAmount('₹2,400.00')).toBe('2400');
    expect(normalizeAmount(null)).toBeNull();
  });
});

describe('findRelated', () => {
  test('a WhatsApp nudge about the same bill is a follow-up of the email task', () => {
    const match = findRelated(
      { kind: 'pay', title: 'Did you pay the PG&E bill?', amount: null, text: 'Did you pay the PG&E bill?' },
      profiles,
      'followup',
    );
    expect(match?.taskId).toBe(1);
  });

  test('an email invoice matching a WhatsApp request links by amount and payee', () => {
    const match = findRelated(
      { kind: 'pay', title: 'Pay Sharma Plumbing', amount: 'INR 2,400.00', text: 'Invoice from Sharma Plumbing, amount due INR 2,400.00' },
      profiles,
      'followup',
    );
    expect(match?.taskId).toBe(3);
  });

  test('does not merge two different bills that only share generic words', () => {
    const match = findRelated(
      { kind: 'pay', title: 'Pay Verizon', amount: '$60.00', text: 'Your Verizon bill is ready. Amount due $60.00' },
      profiles,
      'followup',
    );
    expect(match).toBeNull();
  });

  test('does not merge on amount alone', () => {
    const match = findRelated(
      { kind: 'pay', title: 'Pay Comcast', amount: '$84.20', text: 'Comcast amount due $84.20' },
      profiles,
      'followup',
    );
    expect(match).toBeNull();
  });

  test('a follow-up must be the same kind of work', () => {
    const match = findRelated(
      { kind: 'sign', title: 'Sign PG&E form', amount: null, text: 'Please sign the PG&E form' },
      [pge],
      'followup',
    );
    expect(match).toBeNull();
  });

  test('a mention needs stronger overlap than a follow-up', () => {
    expect(findRelated({ kind: null, title: '', amount: null, text: 'PG&E outage tonight' }, profiles, 'mention')).toBeNull();
    expect(
      findRelated({ kind: null, title: '', amount: null, text: 'The lease renewal for 2027 is with the landlord now' }, profiles, 'mention')
        ?.taskId,
    ).toBe(2);
  });
});

describe('looksDone', () => {
  test.each(['Paid the PG&E bill', 'payment received, thanks', 'Signed and sent back', 'cheque deposited', 'done ✅'])(
    '"%s" reads as done',
    (text) => expect(looksDone(text)).toBe(true),
  );

  test.each(['Did you pay the PG&E bill?', 'please sign the lease', 'have you paid?', 'not done yet'])(
    '"%s" does not',
    (text) => expect(looksDone(text)).toBe(false),
  );
});

test('a "done" report needs only one distinctive shared word, since it is just a hint', () => {
  expect(findRelated({ kind: null, title: '', amount: null, text: 'Paid the PG&E bill' }, profiles, 'done')?.taskId).toBe(1);
  expect(findRelated({ kind: null, title: '', amount: null, text: 'Paid the electricity bill' }, profiles, 'done')).toBeNull();
});
