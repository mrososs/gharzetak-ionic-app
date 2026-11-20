import { KHAYOOTA_TOUR } from './definitions/khayoota.tour';
import { PATTERN_READER_TOUR } from './definitions/pattern-reader.tour';
import { PATTERNS_TOUR } from './definitions/patterns.tour';
import { PROJECT_CREATE_TOUR } from './definitions/project-create.tour';
import { TRACKER_PARTS_TOUR, TRACKER_PATTERN_TOUR, TRACKER_SIMPLE_TOUR } from './definitions/tracker.tours';
import { WELCOME_TOUR } from './definitions/welcome.tour';
import type { TourId } from './tour-ids';
import type { TourDefinition } from './tour.types';

/** id → definition. Definitions are plain data; only the engine (driver.js) is loaded lazily, when a tour actually starts. */
export const TOUR_REGISTRY: Readonly<Record<TourId, TourDefinition>> = {
  welcome: WELCOME_TOUR,
  patterns: PATTERNS_TOUR,
  'pattern-reader': PATTERN_READER_TOUR,
  'tracker-simple': TRACKER_SIMPLE_TOUR,
  'tracker-pattern': TRACKER_PATTERN_TOUR,
  'tracker-parts': TRACKER_PARTS_TOUR,
  'project-create': PROJECT_CREATE_TOUR,
  khayoota: KHAYOOTA_TOUR,
};

export const ALL_TOURS: readonly TourDefinition[] = Object.values(TOUR_REGISTRY);

export const definitionOf = (id: TourId): TourDefinition => TOUR_REGISTRY[id];

export const routeMatches = (def: TourDefinition, path: string): boolean => def.route.match.test(path.split(/[?#]/)[0]);
