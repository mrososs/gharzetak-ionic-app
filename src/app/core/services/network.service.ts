import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';

/** Online/offline state (Capacitor Network on device, navigator.onLine on the web). */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  readonly online = signal<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor() {
    Network.getStatus()
      .then((s) => this.set(s.connected))
      .catch(() => undefined);
    Network.addListener('networkStatusChange', (s) => this.set(s.connected)).catch(() => undefined);
  }

  onChange(fn: (online: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(v: boolean): void {
    if (v === this.online()) return;
    this.online.set(v);
    this.listeners.forEach((fn) => fn(v));
  }
}
