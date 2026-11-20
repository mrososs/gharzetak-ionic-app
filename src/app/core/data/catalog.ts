/* Reference data — ported from the approved prototype (Main.dc.html, Part A). */
import { IconName } from './icons';

export type Lang = 'ar' | 'en';
export type Tone = 'lav' | 'blush' | 'sage' | 'peach' | 'cream' | 'plum';
export type Bi = { readonly ar: string; readonly en: string };

export const CAT_IDS = ['amigurumi', 'clothes', 'accessories', 'home', 'gifts'] as const;
export type CategoryId = (typeof CAT_IDS)[number];
export const CAT: Record<CategoryId, Bi & { icon: IconName; tone: Tone; altAr: string; altEn: string }> = {
  amigurumi: { icon: 'smile', tone: 'lav', ar: 'أميجورومي', en: 'Amigurumi', altAr: 'صورة: دمية أميجورومي مصنوعة يدويًا', altEn: 'Photo: handmade amigurumi doll' },
  clothes: { icon: 'shirt', tone: 'blush', ar: 'ملابس', en: 'Clothes', altAr: 'صورة: بلوفر كروشيه مصنوع يدويًا', altEn: 'Photo: hand-crocheted sweater' },
  accessories: { icon: 'bag', tone: 'sage', ar: 'إكسسوارات', en: 'Accessories', altAr: 'صورة: حقيبة كروشيه بزهور', altEn: 'Photo: crochet bag with flowers' },
  home: { icon: 'plant', tone: 'peach', ar: 'ديكور المنزل', en: 'Home Decor', altAr: 'صورة: سلة كروشيه لديكور المنزل', altEn: 'Photo: crochet basket home decor' },
  gifts: { icon: 'gift', tone: 'blush', ar: 'هدايا', en: 'Gifts', altAr: 'صورة: هدية كروشيه مغلّفة', altEn: 'Photo: wrapped crochet gift' },
};

export const HOOKS = ['2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '6.0'] as const;

export const YARN_IDS = ['cotton', 'acrylic', 'wool', 'velvet', 'blend', 'milk'] as const;
export type YarnId = (typeof YARN_IDS)[number];
export const YARN: Record<YarnId, Bi & { tone: Tone; altAr: string; altEn: string }> = {
  cotton: { tone: 'lav', ar: 'قطن', en: 'Cotton', altAr: 'صورة: كرات خيط قطن', altEn: 'Photo: cotton yarn balls' },
  acrylic: { tone: 'blush', ar: 'أكريليك', en: 'Acrylic', altAr: 'صورة: خيط أكريليك', altEn: 'Photo: acrylic yarn' },
  wool: { tone: 'cream', ar: 'صوف', en: 'Wool', altAr: 'صورة: خيط صوف', altEn: 'Photo: wool yarn' },
  velvet: { tone: 'sage', ar: 'قطيفة', en: 'Velvet', altAr: 'صورة: خيط قطيفة', altEn: 'Photo: velvet yarn' },
  blend: { tone: 'peach', ar: 'خليط', en: 'Blend', altAr: 'صورة: خيط خليط', altEn: 'Photo: blended yarn' },
  milk: { tone: 'cream', ar: 'قطن حليبي', en: 'Milk cotton', altAr: 'صورة: قطن حليبي', altEn: 'Photo: milk cotton yarn' },
};

export const ACC_IDS = ['markers', 'needle', 'scissors', 'stuffing', 'tape', 'eyes'] as const;
export type AccessoryId = (typeof ACC_IDS)[number];
export const ACC: Record<AccessoryId, Bi> = {
  markers: { ar: 'علامات غرز', en: 'Stitch markers' },
  needle: { ar: 'إبرة صوف', en: 'Yarn needle' },
  scissors: { ar: 'مقص', en: 'Scissors' },
  stuffing: { ar: 'حشو', en: 'Stuffing' },
  tape: { ar: 'متر قياس', en: 'Tape measure' },
  eyes: { ar: 'عيون أمان', en: 'Safety eyes' },
};

export const LVL_IDS = ['beginner', 'intermediate', 'advanced'] as const;
export type LevelId = (typeof LVL_IDS)[number];
export const LVL: Record<LevelId, Bi & { icon: IconName; tone: Tone; dAr: string; dEn: string }> = {
  beginner: { icon: 'sprout', tone: 'sage', ar: 'مبتدئة', en: 'Beginner', dAr: 'لسه بتعلّمي الأساسيات', dEn: "I'm still learning the basics" },
  intermediate: { icon: 'chart', tone: 'peach', ar: 'متوسطة', en: 'Intermediate', dAr: 'بعرف الغرز وبشتغل باترنات بسيطة', dEn: 'I know the stitches and follow simple patterns' },
  advanced: { icon: 'crown', tone: 'lav', ar: 'متقدمة', en: 'Advanced', dAr: 'بقرأ أي باترن وبعدّل عليه', dEn: 'I read any pattern and adapt it' },
};

export const ACTN: Record<'ch' | 'sc' | 'hdc' | 'dc' | 'tr' | 'inc' | 'dec' | 'hdc-inc' | 'hdc-dec' | 'dc-inc' | 'dc-dec' | 'tr-inc' | 'tr-dec', Bi> = {
  ch: { ar: 'سلسلة', en: 'Chain' },
  sc: { ar: 'غرزة قصيرة', en: 'Single crochet' },
  hdc: { ar: 'نص عمود', en: 'Half double crochet' },
  dc: { ar: 'عمود', en: 'Double crochet' },
  tr: { ar: 'عمود مزدوج', en: 'Treble crochet' },
  inc: { ar: 'زيادة', en: 'Increase' },
  dec: { ar: 'تنقيص', en: 'Decrease' },
  'hdc-inc': { ar: 'زيادة نص عمود', en: 'Half double increase' },
  'hdc-dec': { ar: 'تنقيص نص عمود', en: 'Half double decrease' },
  'dc-inc': { ar: 'زيادة عمود', en: 'Double crochet increase' },
  'dc-dec': { ar: 'تنقيص عمود', en: 'Double crochet decrease' },
  'tr-inc': { ar: 'زيادة عمود مزدوج', en: 'Treble increase' },
  'tr-dec': { ar: 'تنقيص عمود مزدوج', en: 'Treble decrease' },
};

export interface TermEntry {
  k: string; usN: string; ukN: string; us: string; uk: string; tone: Tone;
  ar: string; en: string; ex: string; exAr: string; exEn: string;
}
export const TERMS: readonly TermEntry[] = [
  { k: 'ch', usN: 'Chain', ukN: 'Chain', us: 'ch', uk: 'ch', tone: 'cream', ar: 'السلسلة: أساس كل شغل كروشيه. بتعمليها بسحب الخيط من خلال الحلقة اللي على الإبرة.', en: 'The foundation of most work. Pull the yarn through the loop on your hook.', ex: 'ch 10', exAr: '10 غرز سلسلة', exEn: '10 chain stitches' },
  { k: 'sl', usN: 'Slip stitch', ukN: 'Slip stitch', us: 'sl st', uk: 'ss', tone: 'cream', ar: 'غرزة الوصل: غرزة قصيرة جدًا بتستخدميها لقفل الدور أو للانتقال من مكان لمكان.', en: 'A very short stitch used to join a round or move along without adding height.', ex: 'sl st in 1st st', exAr: 'وصل في أول غرزة', exEn: 'join in the first stitch' },
  { k: 'sc', usN: 'Single crochet', ukN: 'Double crochet', us: 'sc', uk: 'dc', tone: 'lav', ar: 'أشهر غرزة في الأميجورومي: غرزة قصيرة وكثيفة. نفس الشكل بتتسمى dc في النظام البريطاني.', en: 'The most used amigurumi stitch: short and dense. Called dc in UK terms.', ex: '6sc', exAr: '6 غرز قصيرة', exEn: '6 single crochets' },
  { k: 'hdc', usN: 'Half double crochet', ukN: 'Half treble', us: 'hdc', uk: 'htr', tone: 'blush', ar: 'نص عمود: أطول من الغرزة القصيرة ومرنة، مناسبة للملابس والقبعات.', en: 'Taller than sc and a bit stretchy. Good for clothes and hats.', ex: '12hdc', exAr: '12 نص عمود', exEn: '12 half double crochets' },
  { k: 'dc', usN: 'Double crochet', ukN: 'Treble', us: 'dc', uk: 'tr', tone: 'sage', ar: 'العمود: غرزة طويلة وسريعة، بتغطي مساحة كبيرة (زي مربعات الجراني).', en: 'A tall, quick stitch that covers space fast (like granny squares).', ex: '3dc in ring', exAr: '3 أعمدة في الحلقة', exEn: '3 double crochets in the ring' },
  { k: 'tr', usN: 'Treble crochet', ukN: 'Double treble', us: 'tr', uk: 'dtr', tone: 'peach', ar: 'العمود المزدوج: أطول غرزة شائعة، بتديكي شغل مفتوح وخفيف.', en: 'The tallest common stitch for open, airy work.', ex: 'tr in next st', exAr: 'عمود مزدوج في الغرزة اللي بعدها', exEn: 'treble in the next stitch' },
  { k: 'dtr', usN: 'Double treble', ukN: 'Triple treble', us: 'dtr', uk: 'trtr', tone: 'peach', ar: 'أطول من العمود المزدوج، بتستخدم في الدانتيل والأشكال الكبيرة.', en: 'Even taller. Used for lace and large open motifs.', ex: 'dtr', exAr: 'غرزة طويلة جدًا', exEn: 'a very tall stitch' },
  { k: 'inc', usN: 'Increase', ukN: 'Increase', us: 'inc', uk: 'inc', tone: 'blush', ar: 'الزيادة: غرزتين قصيرتين في نفس الغرزة. بتاخدي غرزة 1 وبتطلّعي 2، وبتستخدميها لتوسيع الشكل.', en: 'Two stitches in the same stitch: consumes 1, produces 2. Used to widen the shape.', ex: '(sc, inc) × 6', exAr: 'غرزة وزيادة × 6', exEn: 'a stitch then an increase, six times' },
  { k: 'dec', usN: 'Decrease', ukN: 'Decrease', us: 'dec', uk: 'dec', tone: 'sage', ar: 'التنقيص: ضم غرزتين مع بعض (sc2tog). بتاخدي غرزتين وبتطلّعي 1، وبتقفل بيه الشكل.', en: 'Join two stitches together (sc2tog): consumes 2, produces 1. Used to close the shape.', ex: '(2sc, dec) × 6', exAr: 'غرزتين وتنقيص × 6', exEn: 'two stitches then a decrease, six times' },
  { k: 'mr', usN: 'Magic ring', ukN: 'Magic loop', us: 'MR', uk: 'MR', tone: 'lav', ar: 'الحلقة السحرية: بداية الشغل الدائري وتتقفل بسحبة خيط، فمفيش فتحة في النص.', en: 'A start for round work that closes tight, leaving no hole.', ex: '6sc in MR', exAr: '6 غرز في الحلقة السحرية', exEn: '6 single crochets in the magic ring' },
  { k: 'flo', usN: 'Front loop only', ukN: 'Front loop only', us: 'FLO', uk: 'FLO', tone: 'cream', ar: 'الشغل في الحلقة الأمامية فقط: بيعمل خط بارز، ومفيد في تشكيل الأجزاء.', en: 'Work only in the front loop of the stitch to make a ridge.', ex: 'FLO sc', exAr: 'غرزة في الحلقة الأمامية', exEn: 'a stitch in the front loop' },
  { k: 'blo', usN: 'Back loop only', ukN: 'Back loop only', us: 'BLO', uk: 'BLO', tone: 'cream', ar: 'الشغل في الحلقة الخلفية فقط: بيدّي ملمس مسطح وبيساعد في الدمج.', en: 'Work only in the back loop for a flat texture.', ex: 'BLO sc', exAr: 'غرزة في الحلقة الخلفية', exEn: 'a stitch in the back loop' },
  { k: 'st', usN: 'Stitch', ukN: 'Stitch', us: 'st', uk: 'st', tone: 'cream', ar: 'غرزة (اختصار عام).', en: 'Stitch (general abbreviation).', ex: '30 st', exAr: '30 غرزة', exEn: '30 stitches' },
  { k: 'sk', usN: 'Skip', ukN: 'Skip', us: 'sk', uk: 'sk', tone: 'cream', ar: 'تخطّي غرزة من غير ما تشتغلي فيها.', en: 'Skip a stitch without working into it.', ex: 'sk 2 st', exAr: 'تخطّي غرزتين', exEn: 'skip 2 stitches' },
  { k: 'rnd', usN: 'Round', ukN: 'Round', us: 'R / Rnd', uk: 'R / Rnd', tone: 'cream', ar: 'دور كامل حوالين الشكل في الشغل الدائري.', en: 'One complete trip around the work.', ex: 'R5', exAr: 'الدور الخامس', exEn: 'round five' },
];
export const TERM_AR_NAME: Record<string, string> = {
  ch: 'سلسلة', sl: 'غرزة وصل', sc: 'غرزة قصيرة', hdc: 'نص عمود', dc: 'عمود', tr: 'عمود مزدوج', dtr: 'عمود مزدوج طويل',
  inc: 'زيادة', dec: 'تنقيص', mr: 'حلقة سحرية', flo: 'الحلقة الأمامية فقط', blo: 'الحلقة الخلفية فقط', st: 'غرزة', sk: 'تخطّي', rnd: 'دور',
};

export type VideoCat = 'basics' | 'stitches' | 'amigurumi' | 'clothes' | 'home';
export type VideoLevel = 'beg' | 'int' | 'adv';
export interface VideoTopic {
  id: string; cat: VideoCat; lvl: VideoLevel; tone: Tone; q: string; ar: string; en: string; dAr: string; dEn: string;
}
export const VIDEOS: readonly VideoTopic[] = [
  { id: 'magic-ring', cat: 'basics', lvl: 'beg', tone: 'lav', q: 'magic ring crochet tutorial beginners', ar: 'الحلقة السحرية (Magic Ring)', en: 'Magic ring (magic circle)', dAr: 'إزاي تبدئي أي شغل دائري من غير فتحة في النص.', dEn: 'Start any round project without a hole in the middle.' },
  { id: 'sc-basic', cat: 'stitches', lvl: 'beg', tone: 'blush', q: 'single crochet for beginners tutorial', ar: 'الغرزة القصيرة للمبتدئات', en: 'Single crochet for beginners', dAr: 'أساس الأميجورومي: وضع الإبرة، سحب الخيط، وعدّ الغرز.', dEn: 'The amigurumi foundation: hook placement, yarn pull-through, counting.' },
  { id: 'inc-dec', cat: 'stitches', lvl: 'beg', tone: 'sage', q: 'crochet increase and decrease tutorial amigurumi', ar: 'الزيادة والتنقيص (inc / dec)', en: 'Increase and decrease (inc / dec)', dAr: 'إزاي تزودي وتنقّصي علشان الشكل يتكوّر ويتقفل.', dEn: 'Shape a sphere by widening and closing it.' },
  { id: 'invisible-dec', cat: 'amigurumi', lvl: 'int', tone: 'peach', q: 'invisible decrease amigurumi crochet', ar: 'التنقيص الخفي', en: 'Invisible decrease', dAr: 'تنقيص بيخفي الفتحات في الأجزاء المحشية.', dEn: 'A neater decrease that hides gaps in stuffed parts.' },
  { id: 'read-pattern', cat: 'basics', lvl: 'beg', tone: 'lav', q: 'how to read crochet patterns beginners', ar: 'إزاي تقرأي باترن كروشيه', en: 'How to read a crochet pattern', dAr: 'الاختصارات، الأقواس، علامة × والأرقام بين [ ].', dEn: 'Abbreviations, brackets, the × sign and the [ ] totals.' },
  { id: 'amigurumi-assemble', cat: 'amigurumi', lvl: 'int', tone: 'blush', q: 'how to assemble amigurumi parts sewing', ar: 'تجميع أجزاء الأميجورومي', en: 'Assembling amigurumi parts', dAr: 'حشو وخياطة الرأس والأذن والأطراف بشكل متماثل.', dEn: 'Stuffing and sewing head, ears and limbs evenly.' },
  { id: 'granny', cat: 'home', lvl: 'beg', tone: 'sage', q: 'granny square crochet tutorial beginners', ar: 'مربع الجراني الكلاسيك', en: 'Classic granny square', dAr: 'خطوة بخطوة لأول مربع جراني.', dEn: 'Step by step for your first granny square.' },
  { id: 'no-twist', cat: 'basics', lvl: 'int', tone: 'peach', q: 'crochet in the round avoid twisting join', ar: 'الشغل الدائري من غير التواء', en: 'Working in the round without twisting', dAr: 'ليه الشغل بيطلع معوج وإزاي تتجنبيه.', dEn: 'Why work comes out crooked and how to avoid it.' },
  { id: 'sweater', cat: 'clothes', lvl: 'adv', tone: 'blush', q: 'crochet sweater beginner top down tutorial', ar: 'بلوفر كروشيه من فوق لتحت', en: 'Top-down crochet sweater', dAr: 'تقسيم الأكمام والجسم وحساب الزيادات.', dEn: 'Splitting sleeves and body and planning increases.' },
  { id: 'basket', cat: 'home', lvl: 'beg', tone: 'cream', q: 'crochet basket tutorial cotton cord', ar: 'سلة كروشيه بخيط القطن', en: 'Crochet basket with cotton yarn', dAr: 'قاعدة دائرية وجوانب ثابتة وعروة.', dEn: 'Round base, sturdy sides and a handle.' },
];
export const VCATS = ['all', 'basics', 'stitches', 'amigurumi', 'clothes', 'home'] as const;
export const VCAT_N: Record<(typeof VCATS)[number], Bi> = {
  all: { ar: 'الكل', en: 'All' }, basics: { ar: 'الأساسيات', en: 'Basics' }, stitches: { ar: 'الغرز', en: 'Stitches' },
  amigurumi: { ar: 'أميجورومي', en: 'Amigurumi' }, clothes: { ar: 'ملابس', en: 'Clothes' }, home: { ar: 'ديكور', en: 'Home' },
};
export const VLVL: Record<VideoLevel, Bi & { cls: string }> = {
  beg: { ar: 'مبتدئة', en: 'Beginner', cls: 'sage' }, int: { ar: 'متوسطة', en: 'Intermediate', cls: 'peach' }, adv: { ar: 'متقدمة', en: 'Advanced', cls: 'rose' },
};

export const STORE_CATS: readonly (Bi & { id: string; icon: IconName; tone: Tone; dAr: string; dEn: string })[] = [
  { id: 'yarn', icon: 'yarn', tone: 'lav', ar: 'خيوط', en: 'Yarn', dAr: 'قطن وأكريليك وقطيفة', dEn: 'Cotton, acrylic, velvet' },
  { id: 'hooks', icon: 'hook', tone: 'blush', ar: 'إبر كروشيه', en: 'Hooks', dAr: 'مقاسات من 2 إلى 6 مم', dEn: 'Sizes from 2 to 6 mm' },
  { id: 'kits', icon: 'gift', tone: 'sage', ar: 'كيتات جاهزة', en: 'Kits', dAr: 'كل المستلزمات في علبة', dEn: 'Everything in one box' },
  { id: 'acc', icon: 'scissors', tone: 'peach', ar: 'إكسسوارات', en: 'Accessories', dAr: 'علامات، عيون، حشو', dEn: 'Markers, eyes, stuffing' },
];

/* Built-in sample patterns (also seeded server-side as public samples). Stable UUIDs so they match the DB. */
export const SAMPLE_PATTERN_HEAD_ID = '00000000-0000-4000-8000-0000000000a1';
export const SAMPLE_PATTERN_BASE_ID = '00000000-0000-4000-8000-0000000000a2';
export const P1_TEXT = ['R1: 6sc in MR [6]', 'R2: inc × 6 [12]', 'R3: (sc, inc) × 6 [18]', 'R4: (2sc, inc) × 6 [24]', 'R5: (3sc, inc) × 6 [30]', 'R6: 30sc [30]', 'R7: 30sc [30]', 'R8: (3sc, dec) × 6 [24]', 'R9: (2sc, dec) × 6 [18]', 'R10: (sc, dec) × 6 [12]', 'R11: dec × 6 [6]'].join('\n');
export const P2_TEXT = ['R1: 6sc in MR [6]', 'R2: inc × 6 [12]', 'R3: (sc, inc) × 6 [18]', 'R4: (2sc, inc) × 6 [24]', 'R5: (3sc, inc) × 6 [30]', 'R6: (4sc, inc) × 6 [36]'].join('\n');
