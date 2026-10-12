import { describe, expect, test } from 'vitest';
import { extractTasks, cleanSubject, isBulkSender, type ExtractInput } from '../src/tasks/extract.js';
import { findAmount, findDueDate } from '../src/tasks/dates.js';

// Local noon, so timezone never shifts the calendar day.
const RECEIVED = new Date(2026, 9, 10, 12, 0, 0); // Sat 10 Oct 2026

function email(overrides: Partial<ExtractInput> = {}): ExtractInput {
  return {
    subject: '',
    fromName: 'Priya Shah',
    fromAddress: 'priya@example.com',
    bodyText: null,
    receivedAt: RECEIVED,
    ...overrides,
  };
}

describe('findDueDate', () => {
  test('reads a month-name date after "due"', () => {
    expect(findDueDate('Your payment of $84.20 is due October 15, 2026.', RECEIVED)).toBe('2026-10-15');
  });

  test('resolves a yearless date to this year', () => {
    expect(findDueDate('Amount due by Oct 20th', RECEIVED)).toBe('2026-10-20');
  });

  test('rolls a yearless date far in the past into next year', () => {
    expect(findDueDate('Renewal due Jan 5', RECEIVED)).toBe('2027-01-05');
  });

  test('keeps a recently passed yearless date in this year, as overdue', () => {
    expect(findDueDate('Payment was due Oct 1', RECEIVED)).toBe('2026-10-01');
  });

  test('reads day-first and ISO and numeric dates', () => {
    expect(findDueDate('due 15 November 2026', RECEIVED)).toBe('2026-11-15');
    expect(findDueDate('Due date: 2026-10-30', RECEIVED)).toBe('2026-10-30');
    expect(findDueDate('due 10/25/2026', RECEIVED)).toBe('2026-10-25');
    expect(findDueDate('due 25/10/2026', RECEIVED)).toBe('2026-10-25');
  });

  test('understands today, tomorrow and weekdays', () => {
    expect(findDueDate('This is due today', RECEIVED)).toBe('2026-10-10');
    expect(findDueDate('Please reply by tomorrow', RECEIVED)).toBe('2026-10-11');
    expect(findDueDate('Can you confirm by Friday?', RECEIVED)).toBe('2026-10-16');
  });

  test('ignores dates with no deadline keyword nearby', () => {
    expect(findDueDate('Statement date: Oct 1, 2026. Thanks for banking with us.', RECEIVED)).toBeNull();
  });

  test('does not treat "sent by X on <date>" as a deadline', () => {
    expect(findDueDate('This notice was sent by PG&E on Oct 3', RECEIVED)).toBeNull();
  });

  test('reads hyphenated day-month dates', () => {
    expect(findDueDate('due 12-oct', RECEIVED)).toBe('2026-10-12');
    expect(findDueDate('due Oct-12-2026', RECEIVED)).toBe('2026-10-12');
  });

  test('rejects impossible dates', () => {
    expect(findDueDate('due Feb 31, 2027', RECEIVED)).toBeNull();
  });
});

describe('findAmount', () => {
  test('prefers the amount next to a money keyword', () => {
    expect(findAmount('Last month you paid $20.00. Amount due: $84.20')).toBe('$84.20');
  });

  test('handles rupees and thousands separators', () => {
    expect(findAmount('Total due ₹12,450.00 by 20 Oct')).toBe('₹12,450.00');
    expect(findAmount('Please pay Rs. 1,200')).toBe('Rs. 1,200');
  });

  test('reads a currency written after the number, and normalises it', () => {
    expect(findAmount('pay 350$ today')).toBe('$350');
    expect(findAmount('fees 1,200 rs by Friday')).toBe('₹1,200');
    expect(findAmount('send 40 dollars')).toBe('$40');
  });

  test('returns null when there is no amount', () => {
    expect(findAmount('Your bill is ready')).toBeNull();
  });
});

describe('extractTasks', () => {
  test('finds a bill with amount and due date', () => {
    const [task, ...rest] = extractTasks(
      email({
        subject: 'Your PG&E bill is ready',
        fromName: 'PG&E',
        fromAddress: 'noreply@pge.com',
        bodyText: 'Amount due: $84.20\nDue date: Oct 15, 2026',
      }),
    );
    expect(rest).toHaveLength(0);
    expect(task).toMatchObject({ kind: 'pay', title: 'Pay PG&E', amount: '$84.20', dueDate: '2026-10-15' });
  });

  test('finds a direct instruction to pay, titled after the payee', () => {
    const [task] = extractTasks(
      email({ subject: 'pay invoice to testfirm', fromName: '', fromAddress: 'neerajxp@gmail.com', bodyText: 'pay invoice to testfirm' }),
    );
    expect(task).toMatchObject({ kind: 'pay', title: 'Pay testfirm' });
  });

  test.each([
    'Please pay the maintenance by Oct 15',
    'Reminder to pay rent',
    'Pay the outstanding balance',
    'Kindly pay school fees',
  ])('recognises "%s" as a payment', (subject) => {
    expect(extractTasks(email({ subject }))[0]?.kind).toBe('pay');
  });

  test('ignores payment confirmations and receipts', () => {
    expect(
      extractTasks(email({ subject: 'Thank you for your payment', bodyText: 'Your payment of $84.20 was received.' })),
    ).toEqual([]);
    expect(extractTasks(email({ subject: 'Your receipt from Uber', bodyText: 'Total $12.40' }))).toEqual([]);
  });

  test('ignores bills already on autopay', () => {
    expect(
      extractTasks(
        email({ subject: 'Your statement is ready', bodyText: 'Amount due $50. Autopay is scheduled for Oct 20.' }),
      ),
    ).toEqual([]);
  });

  test('finds a signature request and tidies the title', () => {
    const [task] = extractTasks(
      email({ subject: 'Please DocuSign: Lease renewal 2027', fromAddress: 'dse@docusign.net' }),
    );
    expect(task).toMatchObject({ kind: 'sign', title: 'Sign: Lease renewal 2027' });
  });

  test('does not ask you to sign something already completed', () => {
    expect(extractTasks(email({ subject: 'Completed: Lease renewal 2027 — DocuSign' }))).toEqual([]);
  });

  test('finds a cheque to write', () => {
    const [task] = extractTasks(
      email({
        subject: 'Society maintenance',
        bodyText: 'Please drop off a cheque of ₹3,500 payable to Green Acres by Oct 12.',
      }),
    );
    expect(task).toMatchObject({ kind: 'cheque', amount: '₹3,500', dueDate: '2026-10-12' });
  });

  test('does not mistake "check out" for a cheque', () => {
    expect(extractTasks(email({ subject: 'Check out our new arrivals' }))).toEqual([]);
  });

  test('finds a personal request that needs a reply', () => {
    const [task] = extractTasks(
      email({ subject: 'Re: Saturday venue', bodyText: 'Can you confirm by Friday if 12 people works?' }),
    );
    expect(task).toMatchObject({ kind: 'reply', title: 'Reply to Priya Shah — Saturday venue', dueDate: '2026-10-16' });
  });

  test('never asks you to reply to a no-reply address', () => {
    expect(
      extractTasks(email({ fromAddress: 'no-reply@shop.com', bodyText: 'Please let me know if you have questions' })),
    ).toEqual([]);
  });

  test('ignores requests that only appear in a quoted older message', () => {
    expect(
      extractTasks(
        email({
          subject: 'Re: Saturday venue',
          bodyText: 'Sounds good, see you then.\n\nOn Fri, Oct 9, 2026 at 9:00 AM Me wrote:\n> Can you confirm by Friday?',
        }),
      ),
    ).toEqual([]);
  });

  test('keeps a deadline only when it has a date', () => {
    const [task] = extractTasks(email({ subject: 'Passport renewal', bodyText: 'Your passport expires on Nov 2, 2026.' }));
    expect(task).toMatchObject({ kind: 'deadline', dueDate: '2026-11-02' });
    expect(extractTasks(email({ subject: 'Reminder about our policies' }))).toEqual([]);
  });

  test('does not turn a sale into a deadline', () => {
    expect(extractTasks(email({ subject: 'Last day: 40% off sale ends today' }))).toEqual([]);
  });

  test('does not add a duplicate deadline when a bill already matched', () => {
    const tasks = extractTasks(email({ subject: 'Reminder: payment due Oct 15', bodyText: 'Amount due $20' }));
    expect(tasks.map((t) => t.kind)).toEqual(['pay']);
  });

  test('works on the subject alone before the body is fetched', () => {
    const [task] = extractTasks(email({ subject: 'Your Verizon bill is ready', fromName: 'Verizon', bodyText: null }));
    expect(task).toMatchObject({ kind: 'pay', title: 'Pay Verizon' });
  });
});

describe('helpers', () => {
  test('cleanSubject strips reply prefixes and tags', () => {
    expect(cleanSubject('RE: Fwd: [EXTERNAL] Lunch?')).toBe('Lunch?');
    expect(cleanSubject('   ')).toBe('(no subject)');
  });

  test('isBulkSender spots automated mailboxes', () => {
    expect(isBulkSender('noreply@x.com')).toBe(true);
    expect(isBulkSender('do-not-reply@x.com')).toBe(true);
    expect(isBulkSender('priya@x.com')).toBe(false);
  });
});
