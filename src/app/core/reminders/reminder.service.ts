import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { instanceLabel, siblingsOf } from '../domain/collections';
import { I18nService } from '../i18n/i18n.service';
import { ReminderPrefs, reminderPrefsOf } from '../joy/joy.models';
import { TimerService } from '../services/timer.service';
import { AppStore } from '../state/app.store';
import { PREVIEW_ID, PlanProject, isReminderId, pickTarget, planReminders, planSignature, previewReminder } from './reminder-planner';
import { deviceTimeZone, fingerprint } from './reminder-time';
import { NotifPermission, ReminderTransport } from './reminder-transport';

/** What this device last scheduled — a device-level fact (the OS schedule is not per account), kept outside the per-scope prefs. */
interface PlanState {
  readonly owner: string;
  readonly ids: readonly number[];
  readonly sig: string;
  readonly tz: string;
  readonly plannedAt: number;
}
const STATE_KEY = 'gz.reminders.plan';
/** The soft-ask is offered at most once per 30 days on its own (an explicit tap on the bell / switch always works). */
export const SOFT_ASK_EVERY_MS = 30 * 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 1500;

export type EnableResult = 'granted' | 'denied' | 'unsupported';
export type PreviewResult = 'sent' | 'needs-permission' | 'unsupported';

/**
 * Applies the planner's output to the operating system (local notifications — no server, no push, no account data leaves the device).
 *
 *  - Never asks for notification permission on its own: the ONLY prompt comes from {@link enable}, which the UI calls after the user
 *    said "yes" to the soft-ask. Planning, resuming, opening Settings and previewing never prompt.
 *  - Re-plans (debounced, off the counting path) on launch, resume, preference changes, scope changes, project changes and time-zone
 *    changes; cancel + replace is exact because every id lives in one reserved range.
 *  - Cancels everything on logout, account switch, "disable all", a revoked permission and when nothing is left to continue.
 *  - A failure here never affects the app: errors are caught and exposed as `error`.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly store = inject(AppStore);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly transport = inject(ReminderTransport);
  private readonly timer = inject(TimerService);

  /** False in a browser: reminders are an app feature. */
  readonly supported = this.transport.native;
  readonly permission = signal<NotifPermission>('prompt');
  readonly nextAt = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  /** The friendly "want a gentle reminder?" sheet. */
  readonly softAsk = signal(false);

  readonly prefs = computed<ReminderPrefs>(() => reminderPrefsOf(this.store.prefs()));
  /** The user turned reminders on, but the phone's notification permission is off (never granted, or revoked later). */
  readonly needsPermission = computed(() => this.supported && this.prefs().enabled && this.permission() !== 'granted');

  private chain: Promise<unknown> = Promise.resolve();
  private timerId: ReturnType<typeof setTimeout> | null = null;

  /** A signed-in user or a guest. A plain logout is neither: nothing may be scheduled for nobody. */
  private identified(): boolean {
    return this.auth.signedIn() || this.auth.guest();
  }

  /**
   * Cheap trigger for re-planning. It deliberately contains NO progress or per-tap data: recent activity is bucketed to 10 minutes, so a
   * counting session changes it at most once per bucket, and the expensive work (progress) happens only inside the debounced re-plan.
   */
  private readonly trigger = computed(() => {
    const p = this.prefs();
    const projects = this.store.projects();
    const sig = projects.map((x) => `${x.id}.${x.status}.${x.deletedAt ? 1 : 0}.${Math.floor(x.lastWorkedAt / 600_000)}.${x.activeInstanceId ?? ''}${p.showDetails ? '.' + x.name : ''}`).join(',');
    return [this.store.scope(), this.store.loaded(), this.identified(), JSON.stringify(p), this.i18n.lang(), this.timer.running() ? 'run' : 'idle', sig].join('~');
  });

  constructor() {
    if (!this.supported) return;
    effect(() => {
      this.trigger();
      untracked(() => this.requestReplan(DEBOUNCE_MS));
    });
  }

  /* ------------------------------------------------------------------ */
  /* user actions                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * The user said yes. Shows the system permission dialog ONLY now (if it has not been decided yet), then schedules.
   * Never throws; a denied permission leaves reminders off and is reported.
   */
  async enable(): Promise<EnableResult> {
    if (!this.supported) return 'unsupported';
    let st = await this.transport.permission();
    if (st === 'prompt') st = await this.transport.requestPermission();
    this.permission.set(st);
    const granted = st === 'granted';
    await this.store.updatePrefs({ reminders: { ...this.prefs(), enabled: granted, askedAt: Date.now() } });
    if (granted) await this.replan();
    return granted ? 'granted' : 'denied';
  }

  /** "Disable all reminders": switches them off and cancels everything this device scheduled. */
  async disable(): Promise<void> {
    await this.store.updatePrefs({ reminders: { ...this.prefs(), enabled: false } });
    await this.replan();
  }

  /** Changes time / days / frequency / project / nudges / quiet hours / details. The OS schedule follows automatically. */
  async update(patch: Partial<ReminderPrefs>): Promise<void> {
    await this.store.updatePrefs({ reminders: { ...this.prefs(), ...patch } });
    this.requestReplan(0);
  }

  /** The "Preview notification" button: one real notification a few seconds from now. Never prompts for permission. */
  async preview(): Promise<PreviewResult> {
    if (!this.supported) return 'unsupported';
    const st = await this.transport.permission();
    this.permission.set(st);
    if (st !== 'granted') return 'needs-permission';
    const p = this.prefs();
    const target = pickTarget(p, this.planProjects());
    await this.transport.ensureChannels(this.i18n.lang());
    await this.transport.cancel([PREVIEW_ID]);
    await this.transport.schedule([previewReminder({ now: Date.now(), lang: this.i18n.lang(), scopeKey: fingerprint(this.store.scope()), prefs: p, target })]);
    return 'sent';
  }

  async openSystemSettings(): Promise<void> {
    try {
      await this.transport.openSettings();
    } catch {
      /* nothing else to do: the user can open the settings by hand */
    }
  }

  /** Offered at a happy moment (e.g. after a finished project): at most once per 30 days, never if already on or refused by the OS. */
  maybeSoftAsk(now = Date.now()): boolean {
    const p = this.prefs();
    if (!this.supported || p.enabled || this.permission() === 'denied') return false;
    if (p.askedAt !== undefined && now - p.askedAt < SOFT_ASK_EVERY_MS) return false;
    this.softAsk.set(true);
    void this.store.updatePrefs({ reminders: { ...p, askedAt: now } });
    return true;
  }

  /** An explicit tap (the bell, the settings switch): always opens it. */
  openSoftAsk(): void {
    this.softAsk.set(true);
  }

  closeSoftAsk(): void {
    this.softAsk.set(false);
  }

  /** App returned to the foreground: the user may have changed the permission or the time zone meanwhile. */
  async onResume(): Promise<void> {
    if (!this.supported) return;
    await this.refreshPermission();
    this.requestReplan(0);
  }

  async refreshPermission(): Promise<NotifPermission> {
    const st = await this.transport.permission();
    this.permission.set(st);
    return st;
  }

  /* ------------------------------------------------------------------ */
  /* planning                                                            */
  /* ------------------------------------------------------------------ */

  private requestReplan(delayMs: number): void {
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => void this.replan(), delayMs);
  }

  /** Serialised: two overlapping re-plans can never interleave their cancel / schedule calls. */
  replan(): Promise<void> {
    const run = this.chain.then(() => this.doReplan());
    this.chain = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  private async doReplan(): Promise<void> {
    if (!this.supported) return;
    // Wait for the data of the identity that is actually signed in (during a sign-in / account switch the store is still loading).
    if (!this.store.loaded() || this.store.scope() !== this.auth.scope()) return;
    try {
      const prefs = this.prefs();
      const permission = await this.transport.permission();
      this.permission.set(permission);
      const scope = this.store.scope();
      const owner = fingerprint(scope);
      const state = readState();
      const pending = (await this.transport.pendingIds()).filter(isReminderId);

      const on = this.identified() && prefs.enabled && permission === 'granted';
      const now = Date.now();
      const tz = deviceTimeZone();
      const projects = on ? this.planProjects() : [];
      const plan = on
        ? planReminders({ now, tz, lang: this.i18n.lang(), scopeKey: owner, prefs, projects, lastActivityAt: this.lastActivity(now) })
        : [];

      if (!plan.length) {
        // switched off / logged out / another account / permission revoked / nothing left to continue: leave nothing behind
        await this.cancelOurs(pending, state);
        writeState(null);
        this.nextAt.set(null);
        this.error.set(null);
        return;
      }

      const sig = planSignature(plan, owner, tz);
      const ids = plan.map((r) => r.id);
      const upToDate = state?.sig === sig && ids.length === pending.length && ids.every((id) => pending.includes(id));
      if (upToDate) {
        this.nextAt.set(plan[0].at);
        return;
      }
      await this.transport.ensureChannels(this.i18n.lang());
      await this.cancelOurs(pending, state); // exact replace: nothing outdated survives, nothing is duplicated
      await this.transport.schedule(plan); // permission is granted here, so the plugin cannot prompt
      writeState({ owner, ids, sig, tz, plannedAt: now });
      this.nextAt.set(plan[0].at);
      this.error.set(null);
    } catch (e) {
      this.error.set(String((e as Error)?.message ?? e)); // reminders are optional: the app carries on
    }
  }

  private async cancelOurs(pending: readonly number[], state: PlanState | null): Promise<void> {
    const ids = [...new Set([...pending, ...(state?.ids ?? [])])].filter(isReminderId);
    if (ids.length) await this.transport.cancel(ids);
  }

  /** Last crochet activity: the most recent project work, or now while the work timer is running. */
  private lastActivity(now: number): number | null {
    if (this.timer.running()) return now;
    const last = Math.max(0, ...this.store.projects().map((p) => p.lastWorkedAt));
    return last > 0 ? last : null;
  }

  /** Facts about the user's projects for the planner. Progress is computed here (debounced), never on the tap path. */
  private planProjects(): PlanProject[] {
    return this.store.projects().map((p) => {
      const open = p.status === 'active' && !p.deletedAt;
      const inst = open ? this.store.activeInstance(p) : null;
      const snap = inst ? (p.partSnapshots ?? []).find((s) => s.partId === inst.partId) : undefined;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        deletedAt: p.deletedAt,
        lastWorkedAt: p.lastWorkedAt,
        progress: open ? this.store.progress(p).pct / 100 : 0,
        activeInstanceId: inst?.id ?? null,
        pieceLabel: inst ? instanceLabel(inst, snap, siblingsOf(p.parts ?? [], inst)) : null,
        hasPhoto: !!p.coverLocalUrl || p.photos.length > 0,
      };
    });
  }
}

function readState(): PlanState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as PlanState) : null;
  } catch {
    return null;
  }
}

function writeState(s: PlanState | null): void {
  try {
    if (s) localStorage.setItem(STATE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STATE_KEY);
  } catch {
    /* private mode: the schedule is still exact because stale ids are found through getPending() */
  }
}
