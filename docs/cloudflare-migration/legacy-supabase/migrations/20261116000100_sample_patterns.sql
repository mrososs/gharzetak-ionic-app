-- Built-in sample patterns (public, read-only). Same UUIDs are bundled in the app for offline use
-- (src/app/core/data/catalog.ts → SAMPLE_PATTERN_*_ID).
insert into public.patterns (id, owner_id, is_sample, name, name_ar, name_en, level, terms, source_type, attribution, raw_text)
values
  ('00000000-0000-4000-8000-0000000000a1', null, true, 'Amigurumi head (shaped sphere)', 'رأس أميجورومي (كرة بتشكيل)', 'Amigurumi head (shaped sphere)',
   'beginner', 'us', 'sample', 'Gharzetak sample',
   E'R1: 6sc in MR [6]\nR2: inc × 6 [12]\nR3: (sc, inc) × 6 [18]\nR4: (2sc, inc) × 6 [24]\nR5: (3sc, inc) × 6 [30]\nR6: 30sc [30]\nR7: 30sc [30]\nR8: (3sc, dec) × 6 [24]\nR9: (2sc, dec) × 6 [18]\nR10: (sc, dec) × 6 [12]\nR11: dec × 6 [6]'),
  ('00000000-0000-4000-8000-0000000000a2', null, true, 'Round coaster / basket base', 'قاعدة سلة / كوستر دائري', 'Round coaster / basket base',
   'beginner', 'us', 'sample', 'Gharzetak sample',
   E'R1: 6sc in MR [6]\nR2: inc × 6 [12]\nR3: (sc, inc) × 6 [18]\nR4: (2sc, inc) × 6 [24]\nR5: (3sc, inc) × 6 [30]\nR6: (4sc, inc) × 6 [36]')
on conflict (id) do nothing;

insert into public.pattern_rounds (pattern_id, position, round_number, raw, parsed_ok, consumed, produced, declared_total)
values
  ('00000000-0000-4000-8000-0000000000a1', 0, 1, 'R1: 6sc in MR [6]', true, 0, 6, 6),
  ('00000000-0000-4000-8000-0000000000a1', 1, 2, 'R2: inc × 6 [12]', true, 6, 12, 12),
  ('00000000-0000-4000-8000-0000000000a1', 2, 3, 'R3: (sc, inc) × 6 [18]', true, 12, 18, 18),
  ('00000000-0000-4000-8000-0000000000a1', 3, 4, 'R4: (2sc, inc) × 6 [24]', true, 18, 24, 24),
  ('00000000-0000-4000-8000-0000000000a1', 4, 5, 'R5: (3sc, inc) × 6 [30]', true, 24, 30, 30),
  ('00000000-0000-4000-8000-0000000000a1', 5, 6, 'R6: 30sc [30]', true, 30, 30, 30),
  ('00000000-0000-4000-8000-0000000000a1', 6, 7, 'R7: 30sc [30]', true, 30, 30, 30),
  ('00000000-0000-4000-8000-0000000000a1', 7, 8, 'R8: (3sc, dec) × 6 [24]', true, 30, 24, 24),
  ('00000000-0000-4000-8000-0000000000a1', 8, 9, 'R9: (2sc, dec) × 6 [18]', true, 24, 18, 18),
  ('00000000-0000-4000-8000-0000000000a1', 9, 10, 'R10: (sc, dec) × 6 [12]', true, 18, 12, 12),
  ('00000000-0000-4000-8000-0000000000a1', 10, 11, 'R11: dec × 6 [6]', true, 12, 6, 6),
  ('00000000-0000-4000-8000-0000000000a2', 0, 1, 'R1: 6sc in MR [6]', true, 0, 6, 6),
  ('00000000-0000-4000-8000-0000000000a2', 1, 2, 'R2: inc × 6 [12]', true, 6, 12, 12),
  ('00000000-0000-4000-8000-0000000000a2', 2, 3, 'R3: (sc, inc) × 6 [18]', true, 12, 18, 18),
  ('00000000-0000-4000-8000-0000000000a2', 3, 4, 'R4: (2sc, inc) × 6 [24]', true, 18, 24, 24),
  ('00000000-0000-4000-8000-0000000000a2', 4, 5, 'R5: (3sc, inc) × 6 [30]', true, 24, 30, 30),
  ('00000000-0000-4000-8000-0000000000a2', 5, 6, 'R6: (4sc, inc) × 6 [36]', true, 30, 36, 36)
on conflict (pattern_id, position) do nothing;
