import { createPushScheduler } from '../pushScheduler';

interface Item { id: string; updatedAt: number }

function harness() {
  const store: Item[] = [];
  let fail = false;
  const pushItems = jest.fn(async (_items: Item[]) => {
    if (fail) throw new Error('push failed');
  });
  const pushConfig = jest.fn(async () => {});
  const onError = jest.fn();
  const onSuccess = jest.fn();
  const sched = createPushScheduler<Item>({
    getDirty: (wm) => store.filter((i) => i.updatedAt > wm),
    stamp: (i) => i.updatedAt,
    pushItems,
    pushConfig,
    onError,
    onSuccess,
    debounceMs: 800,
    retryBaseMs: 2000,
    retryMaxMs: 60000,
  });
  return { store, sched, pushItems, pushConfig, onError, onSuccess, setFail: (v: boolean) => { fail = v; } };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createPushScheduler', () => {
  it('debounces, pushes dirty items, and advances the watermark on success', async () => {
    const h = harness();
    h.store.push({ id: 'a', updatedAt: 10 });
    h.sched.schedule();
    expect(h.pushItems).not.toHaveBeenCalled(); // still debouncing
    await jest.advanceTimersByTimeAsync(800);
    expect(h.pushItems).toHaveBeenCalledWith([{ id: 'a', updatedAt: 10 }]);
    expect(h.pushConfig).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.sched.watermark).toBe(10);
  });

  it('keeps the watermark put when the push fails, then re-pushes the same item on retry', async () => {
    const h = harness();
    h.setFail(true);
    h.store.push({ id: 'a', updatedAt: 10 });
    h.sched.schedule();
    await jest.advanceTimersByTimeAsync(800);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.sched.watermark).toBe(0); // NOT advanced — the change is still dirty

    h.setFail(false);
    await jest.advanceTimersByTimeAsync(2000); // backoff retry fires
    expect(h.pushItems).toHaveBeenCalledTimes(2);
    expect(h.pushItems).toHaveBeenLastCalledWith([{ id: 'a', updatedAt: 10 }]);
    expect(h.sched.watermark).toBe(10);
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('doubles the backoff delay on repeated failure', async () => {
    const h = harness();
    h.setFail(true);
    h.store.push({ id: 'a', updatedAt: 5 });
    h.sched.schedule();
    await jest.advanceTimersByTimeAsync(800); // flush #1 fails → retry in 2000
    expect(h.pushItems).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1999);
    expect(h.pushItems).toHaveBeenCalledTimes(1); // not yet
    await jest.advanceTimersByTimeAsync(1); // retry #1 (2000) fails → next in 4000
    expect(h.pushItems).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(3999);
    expect(h.pushItems).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1); // retry #2 fires at 4000
    expect(h.pushItems).toHaveBeenCalledTimes(3);
    expect(h.onError).toHaveBeenCalledTimes(3);
  });

  it('flushNow pushes immediately and cancels any pending retry', async () => {
    const h = harness();
    h.setFail(true);
    h.store.push({ id: 'a', updatedAt: 7 });
    h.sched.schedule();
    await jest.advanceTimersByTimeAsync(800); // fail → retry scheduled

    h.setFail(false);
    await h.sched.flushNow();
    expect(h.pushItems).toHaveBeenCalledTimes(2);
    expect(h.sched.watermark).toBe(7);

    // the earlier retry timer must have been cancelled — time passing pushes nothing more
    await jest.advanceTimersByTimeAsync(60000);
    expect(h.pushItems).toHaveBeenCalledTimes(2);
  });

  it('cancel() stops a pending flush and resets the watermark', async () => {
    const h = harness();
    h.store.push({ id: 'a', updatedAt: 9 });
    h.sched.schedule();
    h.sched.cancel();
    await jest.advanceTimersByTimeAsync(800);
    expect(h.pushItems).not.toHaveBeenCalled();

    h.sched.bumpWatermark(50);
    expect(h.sched.watermark).toBe(50);
    h.sched.cancel();
    expect(h.sched.watermark).toBe(0);
  });

  it('still pushes config when there are no dirty items', async () => {
    const h = harness();
    h.sched.schedule();
    await jest.advanceTimersByTimeAsync(800);
    expect(h.pushItems).not.toHaveBeenCalled();
    expect(h.pushConfig).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not re-push items already covered by the watermark', async () => {
    const h = harness();
    h.store.push({ id: 'a', updatedAt: 10 });
    h.sched.bumpWatermark(10); // e.g. this entry arrived via a realtime echo
    h.sched.schedule();
    await jest.advanceTimersByTimeAsync(800);
    expect(h.pushItems).not.toHaveBeenCalled(); // 10 is not > 10
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });
});
