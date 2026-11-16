/**
 * Photo slots → bundled images (public/assets/photos). Every file is a free-licence Pexels photo
 * (https://www.pexels.com/license/) listed with its source in docs/design-handoff/asset-manifest.md.
 * A missing key renders the design's labelled tonal placeholder instead (never invented artwork).
 */
const P = (id: number) => `assets/photos/pexels-${id}.jpg`;

export const PHOTOS: Readonly<Record<string, string>> = {
  // onboarding
  ob0: P(17357483), // crocheted bunny on pink
  ob1: P(3945638), // hands crocheting with a purple hook
  ob2: P(5806980), // granny-square blanket
  ob3: P(2731820), // finished amigurumi bunny
  // interests / project fallbacks (by category)
  cat_amigurumi: P(7738663),
  cat_clothes: P(1374128),
  cat_home: P(29242682),
  cat_gifts: P(19558765),
  // cat_accessories: missing — no verified crochet-bag photo yet
  // store
  store_hero: P(4792084),
  store_yarn: P(2767653),
  store_hooks: P(4792084),
  store_patterns: P(8826936),
  // tutorial thumbnails (topic illustrations, not the videos themselves)
  'vid_magic-ring': P(7585792),
  'vid_sc-basic': P(3945638),
  'vid_inc-dec': P(2731820),
  'vid_invisible-dec': P(7738663),
  'vid_read-pattern': P(8826936),
  'vid_amigurumi-assemble': P(17357483),
  vid_granny: P(5806980),
  'vid_no-twist': P(4792059),
  vid_sweater: P(1374128),
  vid_basket: P(29242682),
};

export const photo = (key: string): string => PHOTOS[key] ?? '';
