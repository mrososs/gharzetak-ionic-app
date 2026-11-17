/**
 * Regression fixture: a bunny-with-dress amigurumi written the way testers actually paste patterns —
 * Arabic part headings, mixed punctuation, round ranges, HDC shaping, missing totals, and two assembly rounds.
 *
 * NOTE: the originally supplied bunny pattern text was not available when this fixture was written, so this is a
 * faithful RECONSTRUCTION of the features it was described to contain (arms, legs, ears, body, round ranges,
 * hdc increases/decreases, leg joining in body R7, arm joining in body R17, missing totals, Arabic headings).
 * Replace `BUNNY_DRESS_TEXT` with the original paste to run the same assertions against the real text.
 */
export const BUNNY_DRESS_TEXT = `الأرنوبة بالفستان

الايد:
R1: 6 sc in magic ring (6)
R2: inc x 6 (12)
R3: (sc, inc) x 6 (18)
R4 >> R7 (18)
R8: (sc, dec) x 6 (12)

الرجل:
R1: 6sc in MR [6]
R2: inc × 6 [12]
R3: (hdc, hdc inc) x 6 [18]
R4-R6: 18 hdc [18]
R7: (hdc, hdc dec) x 6 [12]

الودان:
R1: 6 sc in magic ring [6]
R2: (sc + inc) * 3 (9)
R3: 9sc
R4: (sc, dec) x 3 (6)
خيطي الودان في أعلى الراس

الجسم:
R1: 6sc in MR [6]
R2: inc x 6 [12]
R3: (sc, inc) x 6 [18]
R4: (2sc, inc) x 6 [24]
R5: (3sc, inc) x 6 [30]
R6: 4dec, 22sc [26]
R7: 5sc in body + 5sc in legs + 14sc in body + 5sc in legs + 7sc in body (36)
R8 >> R12 (36)
R13: (4sc, dec) x 6 [30]
R14: 30sc [30]
R15: (3sc, dec) x 6 [24]
R16: 24sc [24]
R17: 8sc in body + 6sc in arms + 8sc in body + 6sc in arms + 8sc in body (36)
R18: (4sc, dec) x 6 [30]
`;
