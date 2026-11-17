import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; arg?: unknown }[],
  perm: 'prompt' as string,
  pending: [{ id: 7_000_010 }, { id: 42 }],
  listener: null as null | ((e: { notification: { extra: unknown } }) => void),
  removed: 0,
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => (h.calls.push({ fn: 'checkPermissions' }), { display: h.perm }),
    requestPermissions: async () => (h.calls.push({ fn: 'requestPermissions' }), { display: h.perm }),
    createChannel: async (arg: unknown) => void h.calls.push({ fn: 'createChannel', arg }),
    getPending: async () => ({ notifications: h.pending }),
    cancel: async (arg: unknown) => void h.calls.push({ fn: 'cancel', arg }),
    schedule: async (arg: unknown) => void h.calls.push({ fn: 'schedule', arg }),
    addListener: async (name: string, cb: (e: { notification: { extra: unknown } }) => void) => {
      h.calls.push({ fn: 'addListener', arg: name });
      h.listener = cb;
      return { remove: async () => void h.removed++ };
    },
  },
}));

import { CapacitorReminderTransport } from './reminder-transport';
import { CHANNEL_DETAILS, CHANNEL_PRIVATE, PlannedReminder } from './reminder-planner';

const native = () => {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  return new CapacitorReminderTransport();
};
const reminder = (over: Partial<PlannedReminder> = {}): PlannedReminder => ({
  id: 7_000_010, at: 1_800_000_000_000, title: 'Gharzetak 🧶', body: 'Your stitches are waiting!', kind: 'scheduled', channelId: CHANNEL_PRIVATE,
  extra: { v: 1, kind: 'scheduled', scope: 'abc', projectId: 'p1', instanceId: null }, ...over,
});

describe('CapacitorReminderTransport (against the real plugin API shape)', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.perm = 'prompt';
    h.listener = null;
    h.removed = 0;
  });
  afterEach(() => delete (globalThis as { Capacitor?: unknown }).Capacitor);

  it('schedules INEXACT reminders that still fire while the phone dozes — never the exact-alarm path', async () => {
    await native().schedule([reminder()]);
    const arg = h.calls.find((c) => c.fn === 'schedule')!.arg as { notifications: Record<string, unknown>[] };
    const n = arg.notifications[0];
    expect(n['isExactNotification']).toBe(false); // the plugin default is TRUE, which would open "Alarms & reminders"
    expect(n['isExactMandatory']).toBeUndefined();
    expect(n['schedule']).toEqual({ at: new Date(1_800_000_000_000), allowWhileIdle: true });
    expect(n).toMatchObject({ id: 7_000_010, title: 'Gharzetak 🧶', body: 'Your stitches are waiting!', channelId: CHANNEL_PRIVATE, smallIcon: 'ic_stat_gharzetak', autoCancel: true });
    expect(n['extra']).toEqual({ v: 1, kind: 'scheduled', scope: 'abc', projectId: 'p1', instanceId: null });
    expect(Object.keys(n['extra'] as object).sort()).toEqual(['instanceId', 'kind', 'projectId', 'scope', 'v']); // nothing else travels
  });

  it('every notification in one call is inexact, and an empty plan never calls the plugin', async () => {
    const t = native();
    await t.schedule([reminder({ id: 1 }), reminder({ id: 2, channelId: CHANNEL_DETAILS })]);
    const list = (h.calls.find((c) => c.fn === 'schedule')!.arg as { notifications: { isExactNotification: boolean; channelId: string }[] }).notifications;
    expect(list.map((n) => n.isExactNotification)).toEqual([false, false]);
    expect(list.map((n) => n.channelId)).toEqual([CHANNEL_PRIVATE, CHANNEL_DETAILS]);
    h.calls.length = 0;
    await t.schedule([]);
    expect(h.calls).toEqual([]);
  });

  it('reading the permission never prompts; only requestPermission() does', async () => {
    const t = native();
    h.perm = 'prompt';
    expect(await t.permission()).toBe('prompt');
    h.perm = 'prompt-with-rationale';
    expect(await t.permission()).toBe('prompt');
    h.perm = 'granted';
    expect(await t.permission()).toBe('granted');
    h.perm = 'denied';
    expect(await t.permission()).toBe('denied');
    expect(h.calls.every((c) => c.fn === 'checkPermissions')).toBe(true);
    h.perm = 'granted';
    expect(await t.requestPermission()).toBe('granted');
    expect(h.calls.filter((c) => c.fn === 'requestPermissions')).toHaveLength(1);
  });

  it('creates a PRIVATE channel (a locked screen hides the content) and a separate PUBLIC one for "show details", both normal importance', async () => {
    await native().ensureChannels('en');
    const ch = h.calls.filter((c) => c.fn === 'createChannel').map((c) => c.arg as { id: string; importance: number; visibility: number; name: string });
    expect(ch.map((c) => [c.id, c.importance, c.visibility])).toEqual([[CHANNEL_PRIVATE, 3, 0], [CHANNEL_DETAILS, 3, 1]]);
    h.calls.length = 0;
    await native().ensureChannels('ar');
    expect((h.calls[0].arg as { name: string }).name).toBe('تذكيرات غرزتك');
  });

  it('lists pending ids, cancels exactly the ids it is given, and does nothing for an empty list', async () => {
    const t = native();
    expect(await t.pendingIds()).toEqual([7_000_010, 42]);
    await t.cancel([7_000_010]);
    expect(h.calls.find((c) => c.fn === 'cancel')!.arg).toEqual({ notifications: [{ id: 7_000_010 }] });
    h.calls.length = 0;
    await t.cancel([]);
    expect(h.calls).toEqual([]);
  });

  it('forwards the tapped notification\'s payload (including the tap that launched the app) and can unsubscribe', async () => {
    const got: unknown[] = [];
    const off = await native().onTap((e) => got.push(e));
    expect(h.calls.find((c) => c.fn === 'addListener')!.arg).toBe('localNotificationActionPerformed');
    h.listener!({ notification: { extra: { v: 1, projectId: 'p1' } } });
    expect(got).toEqual([{ v: 1, projectId: 'p1' }]);
    off();
    expect(h.removed).toBe(1);
  });

  it('is a harmless no-op in a browser: no plugin is ever touched', async () => {
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
    const t = new CapacitorReminderTransport();
    expect(t.native).toBe(false);
    expect(await t.permission()).toBe('unsupported');
    expect(await t.requestPermission()).toBe('unsupported');
    await t.ensureChannels('en');
    expect(await t.pendingIds()).toEqual([]);
    await t.cancel([1]);
    await t.schedule([reminder()]);
    const off = await t.onTap(() => undefined);
    off();
    await t.openSettings();
    expect(h.calls).toEqual([]);
  });
});
