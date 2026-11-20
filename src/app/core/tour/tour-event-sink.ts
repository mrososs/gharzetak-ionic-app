import { Injectable, InjectionToken, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { AppStore } from '../state/app.store';
import type { TourEvent, TourEventSink } from './tour.types';

/**
 * The only sink in this implementation: a local, content-free ring buffer inside the scope's own documents (last 200 events).
 * Nothing is sent anywhere. A remote sink is a separate, later decision (see docs/product-tour-discovery/07 §9).
 * The type `TourEvent` has no free-text field, so a project name, pattern text, prompt or token cannot be logged by construction.
 */
@Injectable({ providedIn: 'root' })
export class LocalTourEventSink implements TourEventSink {
  private readonly store = inject(AppStore);
  private readonly i18n = inject(I18nService);

  record(e: TourEvent): void {
    // Fire and forget: logging must never delay or break a tour.
    void this.store.recordTourEvent(e, this.i18n.lang()).catch(() => undefined);
  }
}

export const TOUR_EVENT_SINK = new InjectionToken<TourEventSink>('TOUR_EVENT_SINK', { providedIn: 'root', factory: () => inject(LocalTourEventSink) });
