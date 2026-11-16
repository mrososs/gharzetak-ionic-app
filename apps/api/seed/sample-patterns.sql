-- Built-in sample patterns (read-only, bundled in the app too). Ported from
-- supabase/migrations/20261116000100_sample_patterns.sql with the SAME ids. Idempotent.
INSERT OR IGNORE INTO patterns (id, owner_id, is_sample, name, name_ar, name_en, level, terms, source_type, attribution, raw_text, revision, client_updated_at)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', NULL, 1, 'Amigurumi head (shaped sphere)', 'رأس أميجورومي (كرة بتشكيل)', 'Amigurumi head (shaped sphere)',
   'beginner', 'us', 'sample', 'Gharzetak sample',
   'R1: 6sc in MR [6]' || char(10) || 'R2: inc × 6 [12]' || char(10) || 'R3: (sc, inc) × 6 [18]' || char(10) || 'R4: (2sc, inc) × 6 [24]' || char(10) || 'R5: (3sc, inc) × 6 [30]' || char(10) || 'R6: 30sc [30]' || char(10) || 'R7: 30sc [30]' || char(10) || 'R8: (3sc, dec) × 6 [24]' || char(10) || 'R9: (2sc, dec) × 6 [18]' || char(10) || 'R10: (sc, dec) × 6 [12]' || char(10) || 'R11: dec × 6 [6]', 1, 0),
  ('00000000-0000-4000-8000-0000000000a2', NULL, 1, 'Round coaster / basket base', 'قاعدة سلة / كوستر دائري', 'Round coaster / basket base',
   'beginner', 'us', 'sample', 'Gharzetak sample',
   'R1: 6sc in MR [6]' || char(10) || 'R2: inc × 6 [12]' || char(10) || 'R3: (sc, inc) × 6 [18]' || char(10) || 'R4: (2sc, inc) × 6 [24]' || char(10) || 'R5: (3sc, inc) × 6 [30]' || char(10) || 'R6: (4sc, inc) × 6 [36]', 1, 0);

INSERT OR IGNORE INTO pattern_rounds (pattern_id, position, round_number, raw, parsed_ok, consumed, produced, declared_total)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', 0, 1, 'R1: 6sc in MR [6]', 1, 0, 6, 6),
  ('00000000-0000-4000-8000-0000000000a1', 1, 2, 'R2: inc × 6 [12]', 1, 6, 12, 12),
  ('00000000-0000-4000-8000-0000000000a1', 2, 3, 'R3: (sc, inc) × 6 [18]', 1, 12, 18, 18),
  ('00000000-0000-4000-8000-0000000000a1', 3, 4, 'R4: (2sc, inc) × 6 [24]', 1, 18, 24, 24),
  ('00000000-0000-4000-8000-0000000000a1', 4, 5, 'R5: (3sc, inc) × 6 [30]', 1, 24, 30, 30),
  ('00000000-0000-4000-8000-0000000000a1', 5, 6, 'R6: 30sc [30]', 1, 30, 30, 30),
  ('00000000-0000-4000-8000-0000000000a1', 6, 7, 'R7: 30sc [30]', 1, 30, 30, 30),
  ('00000000-0000-4000-8000-0000000000a1', 7, 8, 'R8: (3sc, dec) × 6 [24]', 1, 30, 24, 24),
  ('00000000-0000-4000-8000-0000000000a1', 8, 9, 'R9: (2sc, dec) × 6 [18]', 1, 24, 18, 18),
  ('00000000-0000-4000-8000-0000000000a1', 9, 10, 'R10: (sc, dec) × 6 [12]', 1, 18, 12, 12),
  ('00000000-0000-4000-8000-0000000000a1', 10, 11, 'R11: dec × 6 [6]', 1, 12, 6, 6),
  ('00000000-0000-4000-8000-0000000000a2', 0, 1, 'R1: 6sc in MR [6]', 1, 0, 6, 6),
  ('00000000-0000-4000-8000-0000000000a2', 1, 2, 'R2: inc × 6 [12]', 1, 6, 12, 12),
  ('00000000-0000-4000-8000-0000000000a2', 2, 3, 'R3: (sc, inc) × 6 [18]', 1, 12, 18, 18),
  ('00000000-0000-4000-8000-0000000000a2', 3, 4, 'R4: (2sc, inc) × 6 [24]', 1, 18, 24, 24),
  ('00000000-0000-4000-8000-0000000000a2', 4, 5, 'R5: (3sc, inc) × 6 [30]', 1, 24, 30, 30),
  ('00000000-0000-4000-8000-0000000000a2', 5, 6, 'R6: (4sc, inc) × 6 [36]', 1, 30, 36, 36);
