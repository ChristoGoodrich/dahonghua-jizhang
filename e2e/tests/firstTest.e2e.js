describe('Main Screen', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should display the main screen with title', async () => {
    await expect(element(by.text('大红花记账'))).toBeVisible();
  });

  it('should display the summary card', async () => {
    await expect(element(by.id('summary-card'))).toBeVisible();
  });

  it('should have the FAB button visible', async () => {
    await expect(element(by.id('fab-add'))).toBeVisible();
  });

  it('should open record sheet when FAB is tapped', async () => {
    await element(by.id('fab-add')).tap();
    await expect(element(by.id('record-sheet'))).toBeVisible();
  });

  it('should close record sheet when close button is tapped', async () => {
    await element(by.id('fab-add')).tap();
    await expect(element(by.id('record-sheet'))).toBeVisible();
    await element(by.id('record-sheet-close')).tap();
    await expect(element(by.id('record-sheet'))).not.toBeVisible();
  });

  it('should navigate to settings', async () => {
    await element(by.id('btn-settings')).tap();
    await expect(element(by.text('设置'))).toBeVisible();
  });

  it('should have bottom navigation with tabs', async () => {
    await expect(element(by.id('nav-list'))).toBeVisible();
    await expect(element(by.id('nav-cal'))).toBeVisible();
    await expect(element(by.id('nav-stats'))).toBeVisible();
    await expect(element(by.id('nav-wall'))).toBeVisible();
  });

  it('should switch tabs when bottom nav is tapped', async () => {
    await element(by.id('nav-cal')).tap();
    await expect(element(by.id('calendar-view'))).toBeVisible();

    await element(by.id('nav-stats')).tap();
    await expect(element(by.id('stats-view'))).toBeVisible();

    await element(by.id('nav-wall')).tap();
    await expect(element(by.id('garden-view'))).toBeVisible();

    await element(by.id('nav-list')).tap();
    await expect(element(by.id('entry-list'))).toBeVisible();
  });
});
