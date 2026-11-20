import { InjectionToken } from '@angular/core';
import { DriverTourRenderer } from './driver-tour-renderer';
import type { TourRenderer } from './tour.types';

/** Where the engine is chosen. Tests provide a fake; the app gets the Driver.js adapter (the engine itself loads lazily on first start). */
export const TOUR_RENDERER = new InjectionToken<TourRenderer>('TOUR_RENDERER', { providedIn: 'root', factory: () => new DriverTourRenderer() });
