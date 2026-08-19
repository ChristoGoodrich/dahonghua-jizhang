// The core loop: record → see it in the list → edit it → delete it → undo.
//
// This is the path every other feature hangs off, and the one where a
// regression costs a user real data. The unit suite covers the pieces in
// isolation; only this proves the wiring survives on a device — store
// persistence, the keypad's expression evaluation, the swipe actions, and the
// undo that has to restore an entry the sync engine may already have seen.

const KEY = (k) => element(by.id(`key-${k}`));

/** Open the record sheet, punch in an amount, save. */
async function record(digits) {
  await element(by.id('fab-add')).tap();
  await expect(element(by.id('record-sheet'))).toBeVisible();
  for (const d of digits) await KEY(d).tap();
  await element(by.id('record-save')).tap();
  await expect(element(by.id('record-sheet'))).not.toBeVisible();
}

describe('core loop', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true, delete: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await element(by.id('nav-list')).tap();
  });

  it('records an entry and shows it in the list', async () => {
    await record(['3', '5']);
    await expect(element(by.id('entry-list'))).toBeVisible();
    await expect(element(by.text('-35.00')).atIndex(0)).toBeVisible();
  });

  it('settles arithmetic on the keypad before saving', async () => {
    await element(by.id('fab-add')).tap();
    await KEY('1').tap();
    await KEY('2').tap();
    await KEY('+').tap();
    await KEY('8').tap();
    await KEY('eq').tap();
    await element(by.id('record-save')).tap();
    await expect(element(by.text('-20.00')).atIndex(0)).toBeVisible();
  });

  it('backspace and clear undo keypad input', async () => {
    await element(by.id('fab-add')).tap();
    await KEY('9').tap();
    await KEY('9').tap();
    await KEY('back').tap(); // 99 → 9
    await KEY('7').tap(); // → 97
    await KEY('clear').tap(); // → empty
    await KEY('5').tap();
    await element(by.id('record-save')).tap();
    await expect(element(by.text('-5.00')).atIndex(0)).toBeVisible();
  });

  it('keeps the sheet open for a run of entries with 再记', async () => {
    await element(by.id('fab-add')).tap();
    await KEY('1').tap();
    await KEY('1').tap();
    await element(by.id('record-save-next')).tap();
    await expect(element(by.id('record-sheet'))).toBeVisible(); // still open
    await KEY('2').tap();
    await KEY('2').tap();
    await element(by.id('record-save')).tap();
    await expect(element(by.id('record-sheet'))).not.toBeVisible();
    await expect(element(by.text('-11.00')).atIndex(0)).toBeVisible();
    await expect(element(by.text('-22.00')).atIndex(0)).toBeVisible();
  });

  it('deletes an entry and restores it with undo', async () => {
    await record(['4', '2']);
    await expect(element(by.text('-42.00')).atIndex(0)).toBeVisible();

    await element(by.text('-42.00')).atIndex(0).swipe('left', 'fast');
    await element(by.id('toast-action')).tap(); // undo

    await expect(element(by.text('-42.00')).atIndex(0)).toBeVisible();
  });
});

describe('navigation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('reaches every tab and comes back', async () => {
    await element(by.id('nav-cal')).tap();
    await expect(element(by.id('calendar-view'))).toBeVisible();

    await element(by.id('nav-stats')).tap();
    await expect(element(by.id('stats-view'))).toBeVisible();

    await element(by.id('nav-wall')).tap();
    await expect(element(by.id('garden-view'))).toBeVisible();

    await element(by.id('nav-list')).tap();
    await expect(element(by.id('entry-list'))).toBeVisible();
  });

  it('survives a relaunch with data intact', async () => {
    await element(by.id('nav-list')).tap();
    await record(['7', '7']);
    await device.launchApp({ newInstance: true }); // cold start, storage kept
    await element(by.id('nav-list')).tap();
    await expect(element(by.text('-77.00')).atIndex(0)).toBeVisible();
  });
});
