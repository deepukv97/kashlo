const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('Index.html', 'utf8');
const schema = vm.runInNewContext(fs.readFileSync('Config.gs', 'utf8') + '; FINANCE');
const year = new Date().getUTCFullYear();
const date = day => `${year}-01-${String(day).padStart(2, '0')}`;
// Fictional records only. Every RPC is intercepted; no Google account or sheet is used.
const snapshot = {
  workspaceRevision: 'browser-test-workspace', sheetUrl: 'https://example.invalid/workbook',
  updatedAt: new Date().toISOString(),
  config: { ...JSON.parse(JSON.stringify(schema)), year, locale: 'en-US', currency: 'USD',
    timeZone: 'UTC', defaultDate: date(15), ownerName: 'Sample User', ownerInitials: 'SU',
    workspaceLabel: 'Sample workspace', appTitle: 'Kashlo' },
  categories: { expense: ['Food', 'Home'], income: ['Salary'], investment: ['Investments'] },
  mappings: { expense: [{ description: 'Sample meal', category: 'Food' }],
    income: [{ description: 'Sample salary', category: 'Salary' }],
    investment: [{ description: 'Sample fund', category: 'Investments' }] },
  trips: ['Sample project'], paymentOptions: { Card: ['Sample card'], UPI: [], 'Bank transfer': [] },
  monthStatus: Array(12).fill('Not reviewed'),
  transactions: Array.from({ length: 30 }, (_, i) => ({
    type: 'expense', row: i + 2, fingerprint: 'fictional-' + i,
    description: i ? 'Sample purchase ' + i : 'Sample meal',
    amount: i ? i + 1 : 12, date: date(i % 28 + 1), category: 'Food',
    trip: '', paymentMethod: 'Card', paymentDetail: 'Sample card', notes: 'Sample note',
    issues: [], decision: 'Pending', reviewNote: '', duplicateGroup: '',
  })),
};
const pageErrors = new WeakMap();

async function openApp(page) {
  await page.addInitScript(({ snapshot }) => {
    window.__snapshot = snapshot;
    window.__calls = [];
    window.__saveMode = 'success';
    window.__receipts = {};
    window.__receiptState = 'notStarted';
    const runner = (success, failure) => new Proxy({}, {
      get(_, method) {
        if (method === 'withSuccessHandler') return handler => runner(handler, failure);
        if (method === 'withFailureHandler') return handler => runner(success, handler);
        return args => {
          window.__calls.push({ method, args });
          if (method === 'getData') return queueMicrotask(() => success(structuredClone(window.__snapshot)));
          if (method === 'getSubmissionStatus') return queueMicrotask(() => window.__receiptState === 'offline'
            ? failure({ message: 'Sample connection unavailable' })
            : success(window.__receipts[args.requestId] || { status: window.__receiptState }));
          const confirmed = result => {
            if (method === 'addTransaction') {
              window.__snapshot.transactions.push({ ...args, row: window.__snapshot.transactions.length + 2,
                amount: Number(args.amount), fingerprint: 'sample-new-' + args.requestId,
                issues: [], decision: 'Pending', reviewNote: '', duplicateGroup: '' });
              window.__receipts[args.requestId] = { status: 'saved', result: { ok: true } };
            }
            success(result);
          };
          if (window.__saveMode === 'pending') {
            window.__pendingSave = { success: confirmed, failure };
            return;
          }
          queueMicrotask(() => window.__saveMode === 'error'
            ? failure({ message: 'Sample server validation failed.' }) : confirmed({ count: 1 }));
        };
      },
    });
    window.google = { script: { run: runner() } };
  }, { snapshot });
  await page.route('http://kashlo.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://kashlo.test/');
  await expect(page.locator('#connectionLabel')).toHaveText('Connected to Google Sheets');
}
async function navigate(page, view) {
  if (await page.locator('#mobileMenuButton').isVisible()) await page.locator('#mobileMenuButton').click();
  await page.locator(`[data-view="${view}"]`).click();
}
async function fillEntry(page, description, amount) {
  await page.locator('#newButton').click();
  await page.locator('#entryDate').fill(date(15));
  await page.locator('#entryDescription').fill(description);
  await page.locator('#entryCategory').selectOption('Food');
  await page.locator('#entryAmount').fill(String(amount));
  await page.locator('#entryTrip').selectOption('Sample project');
  await page.locator('#entryPaymentMethod').selectOption('Card');
  await page.locator('#entryPaymentDetail').selectOption('Sample card');
  await page.locator('#entryNotes').fill('Sample notes for ' + description);
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page)).toEqual([]));

test('entry dialog contains keyboard focus, closes natively, and returns focus', async ({ page }) => {
  await page.locator('#newButton').click();
  const dialog = page.locator('dialog:modal');
  await expect(dialog).toHaveCount(1);
  await expect(page.locator('#entryDescription')).toBeFocused();
  await expect(page.locator('#entryDate')).toHaveValue('');
  // Even a script cannot focus a background button while showModal is active.
  await page.locator('#refreshButton').evaluate(node => node.focus());
  expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#newButton')).toBeFocused();
});

test('positive amounts are required and accessible errors clear after correction', async ({ page }) => {
  await page.locator('#newButton').click();
  await page.locator('#entryDate').fill(date(15));
  await page.locator('#entryDescription').fill('Sample meal');
  await page.locator('#entryCategory').selectOption('Food');
  await page.locator('#entryAmount').fill('0');
  await page.locator('#saveEntry').click();
  await expect(page.locator('#entryAmount')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#entryAmount')).toHaveAttribute('aria-describedby', 'validation-entryAmount');
  await expect(page.locator('#validation-entryAmount')).toBeVisible();
  await expect(page.locator('#entryAmount')).toHaveCSS('border-top-color', 'rgb(241, 131, 128)');
  expect(await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(0);
  await page.locator('#entryAmount').fill('10');
  await expect(page.locator('#entryAmount')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#validation-entryAmount')).toBeHidden();
  await page.evaluate(() => { __saveMode = 'error'; });
  await page.locator('#saveEntry').click();
  await page.getByRole('button', { name: 'Review save', exact: true }).click();
  await expect(page.locator('#formError')).toHaveText(/Sample server validation failed/);
  await expect(page.locator('#formError')).toHaveAttribute('role', 'alert');
  await expect(page.locator('dialog:modal')).toHaveCount(1);
});

test('editing still blocks dismissal until the pending request finishes', async ({ page }) => {
  await navigate(page, 'transactions');
  const details = page.locator('[data-details-row="29"]');
  if (await details.isVisible()) await details.click();
  await page.locator('[data-edit-row="29"]').click();
  await page.locator('#entryAmount').fill('10');
  await page.evaluate(() => { __saveMode = 'pending'; });
  await page.locator('#saveEntry').click();
  await expect(page.locator('#dialogBusy')).toBeVisible();
  await expect(page.locator('dialog')).toHaveAttribute('closedby', 'none');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#cancelEntry').click();
  await expect(page.locator('dialog:modal')).toHaveCount(1);
  await page.evaluate(() => __pendingSave.failure({ message: 'Sample retryable failure' }));
  await expect(page.locator('#dialogBusy')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog:modal')).toHaveCount(0);
});

test('custom calendar commits only on checkmark and retains its native dialog', async ({ page }) => {
  await navigate(page, 'transactions');
  await page.locator('#transactionFilter-period').selectOption('custom');
  await page.locator('#transactionFilter-from').click();
  await page.locator('dialog').evaluate(node => { node.dataset.originalDialog = 'yes'; });
  await page.locator('#calendarMonth').selectOption('0');
  await page.locator('#calendarDay-15').click();
  await expect(page.locator('dialog')).toHaveAttribute('data-original-dialog', 'yes');
  await page.locator('#cancelCalendar').click();
  await expect(page.locator('#transactionFilter-from')).toHaveText(/Choose/);
  await page.locator('#transactionFilter-from').click();
  await page.locator('#calendarDay-15').click();
  await page.locator('#confirmCalendar').click();
  await expect(page.locator('#transactionFilter-from')).toBeFocused();
  await page.locator('#transactionFilter-to').click();
  await expect(page.locator('#calendarDay-14')).toBeDisabled();
  await page.locator('#calendarDay-21').click();
  await page.locator('#confirmCalendar').click();
  await expect(page.locator('#filteredTransactionCount')).toHaveText('7');
});

test('filters preserve search focus and announce a short total across all pages', async ({ page }) => {
  await navigate(page, 'transactions');
  await expect(page.locator('#content')).not.toHaveAttribute('aria-live');
  await page.locator('#search').fill('Sample purchase');
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('#filteredTransactionCount')).toHaveText('29');
  await expect(page.locator('#viewStatus')).toContainText('29 matching transactions');
  await page.locator('#typeFilter').click();
  await page.locator('#applyTransactionMulti').click();
  await expect(page.locator('#typeFilter')).toBeFocused();
  await expect(page.locator('#filteredTransactionCount')).toHaveText('29');
  await page.getByRole('button', { name: 'Next transaction page', exact: true }).click();
  await expect(page.locator('#filteredTransactionCount')).toHaveText('29');
});

test('delete confirmation focuses Cancel and does not delete before confirmation', async ({ page }) => {
  await navigate(page, 'transactions');
  const details = page.locator('[data-details-row="29"]');
  if (await details.isVisible()) await details.click();
  const remove = page.locator('[data-delete-row="29"]');
  await remove.click();
  await expect(page.locator('#cancelDelete')).toBeFocused();
  expect(await page.evaluate(() => __calls.some(c => c.method === 'deleteTransaction'))).toBe(false);
  await page.locator('#cancelDelete').click();
  await expect(remove).toBeFocused();
  await remove.click();
  await page.locator('#confirmDelete').click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  expect(await page.evaluate(() => __calls.filter(c => c.method === 'deleteTransaction').length)).toBe(1);
});

test('mobile navigation enters the top layer and desktop sidebar recovers after resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.locator('#mobileMenuButton').click();
  await expect(page.locator('#navigationPanel')).toHaveAttribute('popover', 'manual');
  expect(await page.locator('#navigationPanel').evaluate(node => node.matches(':popover-open'))).toBe(true);
  await expect(page.locator('#mainWorkspace')).toHaveJSProperty('inert', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileMenuButton')).toBeFocused();
  await page.locator('#mobileMenuButton').click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#navigationPanel')).not.toHaveAttribute('popover');
  await expect(page.locator('[data-view="transactions"]')).toBeVisible();
  await expect(page.locator('#mainWorkspace')).toHaveJSProperty('inert', false);
});

test('dialog fits a narrow and reduced-height viewport, with reachable touch controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#newButton').click();
  await page.setViewportSize({ width: 320, height: 340 });
  const box = await page.locator('dialog:modal').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(340);
  const close = await page.locator('dialog .close').boundingBox();
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
  const journal = await page.locator('#entryType').boundingBox();
  const entryDate = await page.locator('#entryDate').boundingBox();
  expect(journal.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(journal.height - entryDate.height)).toBeLessThanOrEqual(2);
  if (test.info().project.name === 'iphone-webkit')
    await page.screenshot({ path: test.info().outputPath('small-dialog.png') });
  await page.locator('#cancelEntry').scrollIntoViewIfNeeded();
  await page.locator('#cancelEntry').click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  expect(await page.locator('#content').evaluate(node => node.getAnimations().length)).toBe(0);
});

test('blank and selected dates stay aligned and contained on narrow phones', async ({ page }) => {
  await page.locator('#newButton').click();
  for (const width of [320, 393, 430]) {
    await page.setViewportSize({ width, height: 740 });
    for (const value of ['', date(15)]) {
      await page.locator('#entryDate').fill(value);
      const geometry = await page.evaluate(() => {
        const date = document.querySelector('#entryDate');
        const style = getComputedStyle(date);
        const box = node => {
          const { x, y, width, height, right } = node.getBoundingClientRect();
          return { x, y, width, height, right };
        };
        return { date: box(date), field: box(date.closest('.field')),
          journal: box(document.querySelector('#entryType')),
          appearance: style.appearance, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
          overflow: document.querySelector('dialog').scrollWidth - document.querySelector('dialog').clientWidth };
      });
      expect(Math.abs(geometry.date.y - geometry.journal.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.date.height - geometry.journal.height)).toBeLessThanOrEqual(2);
      expect(geometry.date.right).toBeLessThanOrEqual(geometry.field.right + 1);
      expect(Math.abs(geometry.date.width - geometry.journal.width)).toBeLessThanOrEqual(1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.appearance).toBe('none');
      expect(geometry.paddingTop).toBe('0px');
      expect(geometry.paddingBottom).toBe('0px');
    }
  }
  await expect(page.locator('#entryDate')).toHaveValue(date(15));
  expect(await page.locator('#entryDate').evaluate(node => node.checkValidity())).toBe(true);
});

test('Manage and bulk-action dialogs retain their safe actions and confirmation flow', async ({ page }) => {
  await navigate(page, 'payments');
  await page.getByRole('button', { name: 'Edit Sample meal', exact: true }).click();
  await expect(page.locator('#manageChoiceName')).toHaveValue('Sample meal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit Sample meal', exact: true })).toBeFocused();
  await page.locator('[data-manage="groups"]').click();
  await page.getByRole('button', { name: 'Remove Sample project', exact: true }).click();
  await expect(page.locator('#cancelManageChoice')).toBeFocused();
  await page.locator('#cancelManageChoice').click();
  await navigate(page, 'transactions');
  await page.locator('#selectPageTransactions').check();
  await page.locator('#editSelectedTransactions').click();
  await expect(page.locator('#cancelBulkEdit')).toBeFocused();
  await page.locator('#bulkUse-amount').check();
  await page.locator('#bulkAmount').fill('20');
  await page.locator('#saveBulkEdit').click();
  await expect(page.locator('#bulkEditPreview')).toContainText('Amount');
  await page.locator('#cancelBulkEdit').click();
  await page.locator('#deleteSelectedTransactions').click();
  await expect(page.locator('#cancelSelectedDeletion')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => __calls.some(c => ['updateTransactions', 'deleteTransactions', 'manageChoice'].includes(c.method)))).toBe(false);
  await page.evaluate(() => {
    state.data.transactions.slice(0, 2).forEach(entry => {
      entry.issues = ['Possible duplicate']; entry.duplicateGroup = 'fictional-match';
    });
  });
  await navigate(page, 'review');
  await page.locator('#deleteAllDuplicates').click();
  await expect(page.locator('#cancelBulk')).toBeFocused();
  await page.locator('#cancelBulk').click();
  expect(await page.evaluate(() => __calls.some(c => c.method === 'bulkReview'))).toBe(false);
});

test('native dialogs work inside an Apps Script-style sandboxed iframe', async ({ page }) => {
  // Navigate away first so old app timers cannot run in the outer test shell.
  await page.goto('about:blank');
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;width:100vw;height:100dvh;border:0}</style><iframe title="Kashlo test app" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" src="http://kashlo.test/"></iframe>');
  const app = page.frameLocator('iframe');
  await expect(app.locator('#connectionLabel')).toHaveText('Connected to Google Sheets');
  await app.locator('#newButton').click();
  await expect(app.locator('dialog:modal')).toHaveCount(1);
  await app.locator('#refreshButton').evaluate(node => node.focus());
  expect(await app.locator('dialog').evaluate(node => node.contains(document.activeElement))).toBe(true);
  await app.locator('#cancelEntry').click();
  await expect(app.locator('dialog:modal')).toHaveCount(0);
  await expect(app.locator('#newButton')).toBeFocused();
});

test('entrance animations restart without stacking and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const timings = await page.evaluate(() => {
    animateView(); animateView();
    return document.querySelector('#content').getAnimations().map(animation => animation.effect.getTiming().duration);
  });
  expect(timings).toEqual([300]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => {
    animateView(); return document.querySelector('#content').getAnimations().length;
  })).toBe(0);
});

test('multiple new transactions save in order while the next draft stays editable', async ({ page }) => {
  await page.evaluate(() => { __saveMode = 'pending'; });
  await fillEntry(page, 'First sample purchase', 10);
  await page.locator('#saveEntry').click();
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await expect(page.locator('#saveQueueContainer')).toContainText('Saving');
  await fillEntry(page, 'Second sample purchase', 20);
  await page.evaluate(() => __pendingSave.success({ ok: true }));
  await expect.poll(() => page.evaluate(() => __calls.filter(c => c.method === 'getData').length)).toBe(2);
  await expect(page.locator('#entryDescription')).toHaveValue('Second sample purchase');
  await expect(page.locator('#entryAmount')).toHaveValue('20');
  await expect(page.locator('#entryTrip')).toHaveValue('Sample project');
  await expect(page.locator('#entryPaymentDetail')).toHaveValue('Sample card');
  await expect(page.locator('#entryNotes')).toHaveValue('Sample notes for Second sample purchase');
  await page.locator('#saveEntry').click();
  await fillEntry(page, 'Third sample purchase', 30);
  await page.locator('#saveEntry').click();
  expect(await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(2);
  await expect(page.locator('#saveQueueContainer')).toContainText('Waiting to save');
  await page.evaluate(() => __pendingSave.success({ ok: true }));
  await expect.poll(() => page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(3);
  await page.evaluate(() => __pendingSave.success({ ok: true }));
  await expect(page.locator('#saveQueueContainer')).toContainText('0 pending');
  const calls = await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').map(c => c.args));
  expect(calls.map(c => c.amount)).toEqual(['10', '20', '30']);
  expect(new Set(calls.map(c => c.requestId)).size).toBe(3);
  expect(calls.every(c => c.workspaceRevision === 'browser-test-workspace')).toBe(true);
});

test('rejected background entries restore every field and retry with the same submission ID', async ({ page }) => {
  await page.evaluate(() => { __saveMode = 'error'; });
  await fillEntry(page, 'Correctable sample', 10);
  await page.locator('#saveEntry').click();
  await page.getByRole('button', { name: 'Review save', exact: true }).click();
  await expect(page.locator('#entryDescription')).toHaveValue('Correctable sample');
  await expect(page.locator('#entryDate')).toHaveValue(date(15));
  await expect(page.locator('#entryAmount')).toHaveValue('10');
  await expect(page.locator('#entryCategory')).toHaveValue('Food');
  await expect(page.locator('#entryTrip')).toHaveValue('Sample project');
  await expect(page.locator('#entryPaymentMethod')).toHaveValue('Card');
  await expect(page.locator('#entryPaymentDetail')).toHaveValue('Sample card');
  await expect(page.locator('#entryNotes')).toHaveValue('Sample notes for Correctable sample');
  await page.locator('#entryAmount').fill('11');
  await page.evaluate(() => { __saveMode = 'success'; });
  await page.locator('#saveEntry').click();
  await expect(page.locator('#saveQueueContainer')).toContainText('0 pending · 0 need attention');
  const calls = await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').map(c => c.args));
  expect(calls).toHaveLength(2);
  expect(calls[0].requestId).toBe(calls[1].requestId);
  expect(calls[1].amount).toBe('11');
});

test('uncertain writes are retained without automatic replay and do not block unrelated entries', async ({ page }) => {
  await page.evaluate(() => { __saveMode = 'pending'; __receiptState = 'uncertain'; });
  await fillEntry(page, 'Uncertain sample', 10);
  await page.locator('#saveEntry').click();
  await page.evaluate(() => __pendingSave.failure({ message: 'Sample write may have started' }));
  await page.getByRole('button', { name: 'Review save', exact: true }).click();
  await expect(page.locator('dialog')).toContainText('The result is uncertain');
  await expect(page.locator('#entryForm')).toHaveCount(0);
  await expect(page.locator('#retryUnconfirmedSave')).toHaveCount(0);
  await page.locator('#closeSaveReview').click();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  await page.evaluate(() => { __saveMode = 'success'; });
  await fillEntry(page, 'Independent sample', 20);
  await page.locator('#saveEntry').click();
  await expect(page.locator('#saveQueueContainer')).toContainText('1 need attention');
  await expect.poll(() => page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(2);
  expect(await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction' && c.args.description === 'Uncertain sample').length)).toBe(1);
});

test('a lost response is resolved from its receipt without appending again', async ({ page }) => {
  await page.evaluate(() => { __saveMode = 'pending'; });
  await fillEntry(page, 'Confirmed sample', 10);
  await page.locator('#saveEntry').click();
  await page.evaluate(() => {
    const submitted = __calls.find(c => c.method === 'addTransaction').args;
    __receipts[submitted.requestId] = { status: 'saved', result: { ok: true, row: 32 } };
    __pendingSave.failure({ message: 'Sample lost response' });
  });
  await expect(page.locator('#saveQueueContainer')).toContainText('Saved to Google Sheet');
  expect(await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Review save', exact: true })).toHaveCount(0);
});

test('when receipt lookup is unavailable only an identical explicit retry is offered', async ({ page }) => {
  await page.evaluate(() => { __saveMode = 'pending'; __receiptState = 'offline'; });
  await fillEntry(page, 'Offline sample', 10);
  await page.locator('#saveEntry').click();
  await page.evaluate(() => __pendingSave.failure({ message: 'Sample connection lost' }));
  await page.getByRole('button', { name: 'Review save', exact: true }).click();
  await expect(page.locator('#entryForm')).toHaveCount(0);
  await expect(page.locator('#retryUnconfirmedSave')).toBeVisible();
  await page.locator('#retryUnconfirmedSave').click();
  await expect.poll(() => page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(2);
  const calls = await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').map(c => c.args));
  expect(calls[0]).toEqual(calls[1]);
  await page.evaluate(() => __pendingSave.success({ ok: true }));
  await expect(page.locator('#saveQueueContainer')).toContainText('0 pending · 0 need attention');
});

test('double submission is ignored and workspace settings wait for pending entries', async ({ page }) => {
  await page.evaluate(() => { __saveMode = 'pending'; });
  await fillEntry(page, 'Single sample', 10);
  await page.locator('#entryForm').evaluate(form => {
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  });
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  expect(await page.evaluate(() => __calls.filter(c => c.method === 'addTransaction').length)).toBe(1);
  await page.evaluate(() => {
    state.profile = { setupRequired: false };
    const form = document.createElement('form'); form.id = 'profileForm';
    const error = document.createElement('p'); error.id = 'profileError';
    document.querySelector('#content').append(form, error);
    bindProfile();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  });
  await expect(page.locator('#profileError')).toContainText('Finish or review pending transaction saves');
  expect(await page.evaluate(() => __calls.some(c => c.method === 'saveWorkspaceSettings'))).toBe(false);
  await page.evaluate(() => __pendingSave.success({ ok: true }));
});
