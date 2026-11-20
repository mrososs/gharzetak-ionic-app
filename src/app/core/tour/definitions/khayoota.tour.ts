import type { LocalText, TourContext, TourDefinition } from '../tour.types';

/**
 * Khayoota. HIGHLIGHT ONLY, and honest about who is answering: the words follow the status line's own mode. Nothing is sent, no consent
 * sheet opens, no photo picker opens, no request is made, no flag is read or changed. For almost everyone today the answers come from the
 * built-in rules, and the copy says so; hosted AI is described only to someone the server already lets use it.
 */
const STATUS: Record<string, { title: LocalText; body: LocalText }> = {
  rules: {
    title: { ar: 'خيوطة دلوقتي', en: 'Khayoota right now' },
    body: { ar: 'الردود حاليًا من قواعد غرزتك الجاهزة، مش ذكاء اصطناعي. اضغطي على السطر ده للتفاصيل.', en: "Answers currently come from Gharzetak's built-in rules, not AI. Tap this line for details." },
  },
  soon: {
    title: { ar: 'خيوطة الذكية قريبًا', en: 'Khayoota AI is coming' },
    body: { ar: 'خيوطة بالذكاء الاصطناعي لسه في التجربة. لحد ما تتفتح، الردود من قواعد غرزتك.', en: "Khayoota AI is still in testing. Until it opens, answers come from Gharzetak's built-in rules." },
  },
  consent: {
    title: { ar: 'قبل أول سؤال', en: 'Before your first question' },
    body: { ar: 'خيوطة هتطلب موافقتك وتشرحلك إيه اللي بيتبعت قبل ما ترد.', en: 'Khayoota will ask for your OK and explain what is sent before it answers.' },
  },
  ai: {
    title: { ar: 'خيوطة متصلة', en: 'Khayoota is connected' },
    body: { ar: 'خيوطة بترد بالذكاء الاصطناعي وممكن تغلط، فراجعي دايمًا على الباترون. وليها حد يومي للأسئلة.', en: 'Khayoota answers with AI and can be wrong, so always check against your pattern. There is a daily question limit.' },
  },
};
const statusOf = (ctx: TourContext) => STATUS[ctx.khayootaMode] ?? STATUS['rules'];

const isTester = (ctx: TourContext): boolean => ctx.khayootaMode === 'ai' || ctx.khayootaMode === 'consent';

export const KHAYOOTA_TOUR: TourDefinition = {
  id: 'khayoota',
  version: 1,
  route: { match: /^\/tabs\/assistant$/ },
  entry: { url: '/tabs/assistant', mode: 'root' },
  offer: 'pill',
  canRun: (ctx) => ctx.khayootaSettled,
  steps: [
    {
      id: 'khayoota.status',
      target: 'khayoota.status',
      side: 'top',
      align: 'center',
      ifMissing: 'end',
      title: (ctx) => statusOf(ctx).title,
      body: (ctx) => statusOf(ctx).body,
    },
    {
      id: 'khayoota.ask',
      target: 'khayoota.composer',
      side: 'top',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'اكتبي سؤالك', en: 'Type your question' },
      body: { ar: 'اسألي عن غرزة، دور، أو مشكلة في الشغل. مفيش حاجة بتتبعت غير لما تضغطي إرسال.', en: 'Ask about a stitch, a round or a problem in your work. Nothing is sent until you press Send.' },
    },
    {
      id: 'khayoota.controls',
      target: 'khayoota.menu',
      side: 'bottom',
      align: 'end',
      ifMissing: 'skip',
      title: { ar: 'اختياراتك', en: 'Your controls' },
      body: (ctx) =>
        isTester(ctx)
          ? { ar: 'من هنا تمسحي المحادثة، أو تقفلي خيوطة بالذكاء الاصطناعي في أي وقت.', en: 'Clear the chat here, or turn Khayoota AI off at any time.' }
          : { ar: 'من هنا تمسحي المحادثة وتشوفي حالة خيوطة.', en: "Clear the chat and see Khayoota's status here." },
    },
  ],
};
