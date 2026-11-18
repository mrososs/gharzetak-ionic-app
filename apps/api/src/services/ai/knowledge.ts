/**
 * Khayoota's curated crochet knowledge pack (P7, first version).
 *
 * Written originally for Gharzetak in plain words (no text copied from books, blogs or designers). Facts follow common
 * US/UK crochet terminology standards. GLOBAL knowledge only — it never contains user data, and user patterns are never
 * mixed into it (they arrive as request context).
 *
 * Each card has a stable id so answers can cite "Gharzetak guide: <id>". Keep each card short: the whole pack is sent with
 * every request, first and unchanged, so it can benefit from cached-input pricing.
 */
export interface KnowledgeCard {
  readonly id: string;
  readonly topic: 'terms' | 'stitches' | 'shaping' | 'reading' | 'amigurumi' | 'materials' | 'mistakes' | 'app';
  readonly text: string;
}

export const KNOWLEDGE_PACK_VERSION = 1;

export const KNOWLEDGE: readonly KnowledgeCard[] = [
  { id: 'terms.us-uk', topic: 'terms', text: 'US vs UK names for the same stitches: US sc = UK dc; US hdc = UK htr; US dc = UK tr; US tr = UK dtr. A pattern that uses "htr" or "dtr" is almost certainly UK. Gharzetak stores patterns in US terms and can show either.' },
  { id: 'terms.abbrev', topic: 'terms', text: 'Common abbreviations: ch chain, sl st slip stitch, sc single crochet, hdc half double crochet, dc double crochet, tr treble, inc increase (2 stitches in one stitch), dec decrease (2 stitches worked together into 1), MR magic ring, BLO/FLO back/front loop only, st stitch, sk skip, rnd round, [N] or (N) = stitch total at the end of the round.' },
  { id: 'terms.arabic', topic: 'terms', text: 'Arabic names used by Gharzetak: غرزة قصيرة / سنجل = sc; نص عمود = hdc; عمود = dc; عمود مزدوج / طويل = tr; زيادة = inc; نقص / تنقيص = dec; حلقة سحرية = MR; سلسلة = ch. Some people say «حشو» for sc but it also means stuffing, so it always needs checking.' },
  { id: 'stitch.mr', topic: 'stitches', text: 'Magic ring (MR): wrap the yarn around two fingers, insert the hook, pull up a loop, chain 1 to lock, then work the first round of stitches into the ring and pull the tail to close the hole. Stitches worked into the ring do not use stitches from a previous round.' },
  { id: 'stitch.sc', topic: 'stitches', text: 'Single crochet (sc): insert hook, yarn over, pull up a loop (2 loops on hook), yarn over, pull through both loops. Uses 1 stitch, makes 1 stitch. The default dense stitch for amigurumi.' },
  { id: 'stitch.hdc', topic: 'stitches', text: 'Half double crochet (hdc): yarn over, insert hook, yarn over, pull up a loop (3 loops), yarn over, pull through all 3. Taller than sc, shorter than dc. Uses 1, makes 1.' },
  { id: 'stitch.dc', topic: 'stitches', text: 'Double crochet (dc): yarn over, insert hook, pull up a loop (3 loops), yarn over and pull through 2, yarn over and pull through the last 2. About twice the height of sc. Uses 1, makes 1.' },
  { id: 'shape.inc-dec', topic: 'shaping', text: 'Increase (inc) = 2 stitches in the same stitch: uses 1, makes 2, so the piece grows. Decrease (dec, sc2tog) = 2 stitches joined into 1: uses 2, makes 1, so the piece narrows. An invisible decrease works through the front loops of the next 2 stitches and shows less, so amigurumi makers prefer it. "2 hdc in the same st" is an hdc increase, not an sc increase.' },
  { id: 'shape.flat-circle', topic: 'shaping', text: 'A flat circle in sc usually starts with 6 sc in MR and adds 6 increases per round (6, 12, 18, 24 …). Too many increases make the edge ruffle; too few make it cup. Staggering where the increases fall stops the circle turning into a hexagon.' },
  { id: 'reading.repeats', topic: 'reading', text: 'Reading a round: "(sc, inc) x 6 [18]" means repeat "1 sc then 1 increase" six times; each repeat uses 2 stitches and makes 3, so the round uses 12 and ends with 18. The number in [ ] or ( ) at the end is the total to check against. If the written total disagrees with the arithmetic, the pattern needs checking — never change stitches to force the total.' },
  { id: 'reading.ranges', topic: 'reading', text: 'A range such as "R5-R7: 24 sc (24)" means three rounds with the same instruction. "Work even" means no increases or decreases: one stitch in each stitch.' },
  { id: 'amigurumi.spiral', topic: 'amigurumi', text: 'Amigurumi is usually worked in a continuous spiral (no slip-stitch join), so the start of each round drifts diagonally — this lean is normal. A stitch marker in the first stitch of each round keeps the count right.' },
  { id: 'amigurumi.assembly', topic: 'amigurumi', text: 'Assembly: stuff firmly before the last decreases; pin limbs before sewing and count stitches/rounds from a reference point so both sides match; sew with a whip stitch or mattress stitch through both loops; leave a long tail when fastening off pieces that will be sewn.' },
  { id: 'materials.hook-yarn', topic: 'materials', text: 'Hook and yarn: the yarn label suggests a hook size; amigurumi uses a hook 0.5–1 mm smaller than suggested so stuffing does not show through. Cotton gives crisp stitches; acrylic is soft and cheap; tension changes the size of the finished piece more than the yarn brand.' },
  { id: 'mistakes.count', topic: 'mistakes', text: 'Common stitch-count mistakes: missing the first stitch of a round, working twice into the last stitch, losing the round start without a marker, working an increase as two separate stitches, or reading UK terms as US. Counting the stitches of the last round against the written total is the reliable check.' },
  { id: 'mistakes.size', topic: 'mistakes', text: 'Two "matching" pieces come out different sizes when: a round has extra or missing increases, tension changed (tighter or looser), a different hook was used, or a round was repeated/skipped. A photo can show a size difference but cannot prove which of these happened — counting the rounds and stitches can.' },
  { id: 'mistakes.holes', topic: 'mistakes', text: 'Gaps showing stuffing usually mean the hook is too large for the yarn or the tension is loose; a smaller hook or yarn-under technique closes the fabric.' },
  { id: 'app.features', topic: 'app', text: 'Gharzetak features: projects with a stitch counter and round tracker; multi-piece projects (open a piece from the project page); patterns and pattern collections; Smart Paste turns pasted text into rounds and marks each round Validated / Needs Review / Unsupported; editing a pattern keeps the old revision for projects already following it ("Review the update" on the project page); a glossary with US/UK conversion; tutorial topics; timers and reminders.' },
];

/** The pack as one text block for the system prompt. */
export function knowledgeBlock(): string {
  return KNOWLEDGE.map((k) => `[${k.id}] ${k.text}`).join('\n');
}
