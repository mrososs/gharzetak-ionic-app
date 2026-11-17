import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface ImmersiveState {
  /** The user's choice (default on). */
  preferred: boolean;
  /** The navigation bar is actually hidden right now. */
  active: boolean;
  /** A touch-exploration screen reader (TalkBack) is running: system navigation is kept visible for it. */
  touchExploration: boolean;
  sdk: number;
}

interface ImmersivePlugin {
  getState(): Promise<ImmersiveState>;
  setEnabled(opts: { enabled: boolean }): Promise<ImmersiveState>;
  addListener(event: 'state', fn: (s: ImmersiveState) => void): Promise<{ remove: () => Promise<void> }>;
}

/** Native Android bridge (ImmersivePlugin.java). On web / iOS there is no implementation and the service stays inert. */
const Immersive = registerPlugin<ImmersivePlugin>('Immersive');

/**
 * "Immersive display": hides Android's SYSTEM navigation bar (never the app's own bottom tabs, never the status bar).
 * A swipe from the bottom system edge reveals it temporarily; the OS hides it again by itself.
 * The `gz-immersive` class on <html> tells the layout to keep a small floor under the tab bar (gesture area).
 */
@Injectable({ providedIn: 'root' })
export class ImmersiveService {
  private readonly doc = inject(DOCUMENT);
  readonly supported = Capacitor.getPlatform() === 'android';
  readonly state = signal<ImmersiveState>({ preferred: true, active: false, touchExploration: false, sdk: 0 });
  readonly preferred = computed(() => this.state().preferred);
  readonly active = computed(() => this.state().active);
  readonly touchExploration = computed(() => this.state().touchExploration);

  constructor() {
    if (!this.supported) return;
    void Immersive.getState().then((s) => this.apply(s)).catch(() => undefined);
    void Immersive.addListener('state', (s) => this.apply(s)).catch(() => undefined);
  }

  private apply(s: ImmersiveState): void {
    this.state.set(s);
    this.doc.documentElement.classList.toggle('gz-immersive', s.active);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.supported) return;
    this.apply(await Immersive.setEnabled({ enabled }));
  }
}
