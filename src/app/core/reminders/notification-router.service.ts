import { Injectable, inject } from '@angular/core';
import { NavController } from '@ionic/angular';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { AuthService } from '../auth/auth.service';
import { TrackerNavigator } from '../services/tracker-navigator.service';
import { AppStore } from '../state/app.store';
import { ReminderExtra, ReminderKind } from './reminder-planner';
import { fingerprint } from './reminder-time';
import { ReminderTransport } from './reminder-transport';

export type RouteOutcome =
  /** Not one of our payloads (or malformed): ignored, nothing happens. */
  | 'ignored'
  /** A newer tap arrived while this one was waiting (for the biometric unlock, for the data): only the latest is acted on. */
  | 'superseded'
  /** Nobody is signed in (and not a guest): the normal start flow runs, the notification grants nothing. */
  | 'blocked'
  /** The notification belongs to a different account / guest session than the one signed in now: nothing of it is opened or shown. */
  | 'wrong-account'
  | 'opened'
  /** The project no longer exists: the projects list opens with a friendly message. */
  | 'missing'
  /** The project has been finished since: its page opens instead of the counter. */
  | 'done'
  | 'projects';

const KINDS: readonly ReminderKind[] = ['scheduled', 'motivation', 'inactive', 'almostDone', 'photo'];
const idOk = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 80);

/** Validates an untrusted notification payload. Anything unexpected is rejected (returns null). */
export function parseReminderExtra(raw: unknown): ReminderExtra | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o['v'] !== 1 || typeof o['kind'] !== 'string' || !KINDS.includes(o['kind'] as ReminderKind)) return null;
  if (typeof o['scope'] !== 'string' || o['scope'].length === 0 || o['scope'].length > 16) return null;
  if (!idOk(o['projectId']) || !idOk(o['instanceId'])) return null;
  return { v: 1, kind: o['kind'] as ReminderKind, scope: o['scope'], projectId: o['projectId'], instanceId: o['instanceId'] };
}

/**
 * Turns a tap on a reminder into "Project → active piece → current round" — without ever weakening the app's protection.
 * Order matters and is the security design:
 *   1. validate the payload (untrusted input);
 *   2. wait for authentication to initialise and for the BIOMETRIC LOCK to be released (cold and warm start alike);
 *   3. refuse unless somebody is signed in (or in guest mode) — a notification never grants access;
 *   4. refuse unless the payload belongs to exactly this account/guest scope (compared by fingerprint);
 *   5. wait for that scope's data to be loaded, and re-check it;
 *   6. validate the project (still there? finished?) and the piece (still there? retired?);
 *   7. only then navigate. The round itself is the counter's own saved position.
 */
@Injectable({ providedIn: 'root' })
export class NotificationRouter {
  private readonly transport = inject(ReminderTransport);
  private readonly auth = inject(AuthService);
  private readonly store = inject(AppStore);
  private readonly navigator = inject(TrackerNavigator);
  private readonly nav = inject(NavController);
  private readonly ui = inject(UiFeedback);

  private token = 0;
  private started = false;

  /** Registers the tap listener once, early (the plugin keeps a tap that launched the app until a listener is attached). */
  start(): void {
    if (this.started || !this.transport.native) return;
    this.started = true;
    void this.transport.onTap((extra) => void this.handle(extra));
  }

  async handle(raw: unknown): Promise<RouteOutcome> {
    const intent = parseReminderExtra(raw);
    if (!intent) return 'ignored';
    const mine = ++this.token;

    await this.auth.init();
    await this.auth.untilUnlocked(); // the biometric lock is never bypassed: this stays pending until the user unlocks
    if (mine !== this.token) return 'superseded';

    if (!this.auth.signedIn() && !this.auth.guest()) return 'blocked';
    const scope = this.auth.scope();
    if (fingerprint(scope) !== intent.scope) return 'wrong-account';

    await this.store.whenScopeLoaded(scope);
    if (mine !== this.token) return 'superseded';
    if (!this.store.loaded() || this.store.scope() !== scope || fingerprint(this.auth.scope()) !== intent.scope) return 'wrong-account';

    if (!intent.projectId) {
      await this.nav.navigateRoot('/tabs/projects');
      return 'projects';
    }
    const res = await this.navigator.open(intent.projectId, intent.instanceId);
    if (res === 'missing') {
      await this.nav.navigateRoot('/tabs/projects');
      void this.ui.say('المشروع ده مش موجود تاني', 'That project is not here anymore');
      return 'missing';
    }
    if (res === 'done') {
      await this.nav.navigateRoot('/tabs/projects/' + intent.projectId);
      return 'done';
    }
    return 'opened';
  }
}
