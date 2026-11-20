import type { Lang } from '../../core/data/catalog';
import type { DeleteFailure } from '../../core/auth/auth.service';

/**
 * Words of the Delete Account screen, Arabic and English in ONE identical structure (the type below makes the compiler refuse a key
 * that exists in only one language; a unit test also compares them).
 *
 * Every line about what is deleted or retained is a VERIFIED fact about this codebase / its provider, not a promise:
 *   - deleted: every table the account owns (docs/account-deletion/01-deletion-inventory.md) + the files in private storage;
 *   - kept, with the reason: provider recovery history and short-lived technical logs (documented by the provider; per-account
 *     removal is not offered by it), shared anonymous AI daily totals, and copies on OTHER devices.
 * No retention period is invented: the "up to" figures are the provider's published maximums.
 */
export interface DeleteAccountCopy {
  readonly title: string;
  readonly intro: string;
  readonly deletesTitle: string;
  readonly deletes: readonly string[];
  readonly exceptionsTitle: string;
  readonly exceptions: readonly string[];
  readonly irreversibleTitle: string;
  readonly irreversible: string;
  readonly otherDevices: string;
  readonly guestUntouched: string;
  readonly passwordLabel: string;
  readonly passwordHint: string;
  readonly googleHint: string;
  readonly checkingMethod: string;
  readonly confirmCheck: string;
  readonly deleteButton: string;
  readonly deleting: string;
  readonly cancel: string;
  readonly offline: string;
  readonly errors: Readonly<Record<DeleteFailure, string>>;
  readonly localFailed: string;
  readonly successTitle: string;
  readonly successComplete: string;
  readonly successPending: string;
  readonly done: string;
  readonly guestTitle: string;
  readonly guestBody: string;
  readonly backToSettings: string;
}

const ar: DeleteAccountCopy = {
  title: 'حذف الحساب',
  intro: 'ده بيحذف حسابك في غرزتك نهائيًا من السيرفر ومن الجهاز ده. اقري التفاصيل قبل ما تكمّلي.',
  deletesTitle: 'اللي هيتحذف',
  deletes: [
    'حسابك: البريد الإلكتروني، الاسم، كلمة المرور المشفّرة، وربط حساب جوجل.',
    'ملفك الشخصي: الاسم المعروض، المستوى، نظام المصطلحات، الاهتمامات، الشخصية، وأدواتك.',
    'كل مشاريعك: القطع، تقدّم الغرز والأدوار، الملاحظات، جلسات الشغل، والصور.',
    'كل باترناتك ومجموعاتك: النصوص الأصلية والنسخ القديمة وملفات PDF والصور المرفوعة.',
    'المفضّلة، ملاحظات الفيديوهات، وبريد الاهتمام بالمتجر.',
    'موافقة خيوطة (الذكاء الاصطناعي) وعدّادات استخدامك الخاصة بيك.',
    'كل الملفات المخزّنة في التخزين الخاص بحسابك، وجلسات الدخول على كل الأجهزة.',
    'نسخة حسابك المحفوظة على الجهاز ده، وأي عمليات مزامنة لسه مستنية.',
  ],
  exceptionsTitle: 'اللي ممكن يفضل لفترة محدودة',
  exceptions: [
    'مزوّد قاعدة البيانات (Cloudflare) بيحتفظ بسجل استرجاع تقني بيتمسح تلقائيًا مع الوقت — لحد 30 يوم حسب توثيقه. ما نقدرش نمسح حساب واحد من جواه، وبيتمسح لوحده.',
    'سجلات تقنية قصيرة العمر للطلبات عند المزوّد (لحد 7 أيام حسب توثيقه) بتتمسح تلقائيًا.',
    'إجمالي استخدام خيوطة اليومي لكل المستخدمين مع بعض (أرقام تجميعية) — مش مرتبط بيكي ومش بيعرّف بيكي.',
    'حساب جوجل نفسه مش بيتحذف — ده عند جوجل. وبياناتك على أجهزة تانية داخلة بنفس الحساب مش بتتمسح من بعيد: هتتفصل، ومسح بياناتها بيتم من إعدادات الجهاز ده.',
  ],
  irreversibleTitle: 'مفيش رجوع',
  irreversible: 'الحذف نهائي. مش هنقدر نرجّع حسابك ولا مشاريعك ولا ملفاتك بعد ما يتم. لو عايزة نسخة من أي حاجة، احفظيها الأول.',
  otherDevices: 'لو الحساب مفتوح على جهاز تاني، هيتفصل في أول طلب، لكن النسخة المحفوظة عليه هتفضل لحد ما تمسحيها من «مسح بيانات الجهاز» في الإعدادات.',
  guestUntouched: 'بيانات وضع الضيفة على الجهاز (لو موجودة) هي حاجة منفصلة ومش هتتمسح.',
  passwordLabel: 'كلمة المرور الحالية',
  passwordHint: 'بنطلبها علشان نتأكد إنك صاحبة الحساب. بتتبعت للسيرفر بشكل مشفّر ومش بتتخزّن على الجهاز.',
  googleHint: 'حسابك مرتبط بجوجل. لو الدخول مش جديد هنطلب منك تختاري حساب جوجل تاني مرة علشان نتأكد إنك صاحبة الحساب.',
  checkingMethod: 'بنتأكد من طريقة الدخول…',
  confirmCheck: 'فاهمة إن حسابي وكل بياناتي هيتحذفوا نهائيًا ومفيش رجوع.',
  deleteButton: 'احذفي حسابي نهائيًا',
  deleting: 'جاري الحذف…',
  cancel: 'لأ، ارجعي',
  offline: 'مفيش اتصال بالإنترنت. الحذف بيحتاج اتصال علشان يتأكد من السيرفر.',
  errors: {
    offline: 'ماقدرناش نوصل للسيرفر. ما اتمسحش حاجة من جهازك. لو حاولتي تاني وظهرت «الجلسة انتهت»، سجّلي دخول: لو كلمة المرور بقت غلط يبقى الحساب اتحذف فعلًا.',
    wrongPassword: 'كلمة المرور غلط. ما اتحذفش حاجة.',
    reauthRequired: 'الجلسة قديمة وجوجل مش متاح هنا. سجّلي خروج وادخلي من جديد وبعدين جرّبي تاني. ما اتحذفش حاجة.',
    googleCancelled: 'اتلغى اختيار حساب جوجل. ما اتحذفش حاجة.',
    googleFailed: 'ماقدرناش نتأكد من حساب جوجل. جرّبي تاني. ما اتحذفش حاجة.',
    otherAccount: 'ده حساب جوجل مختلف عن حسابك الحالي. اختاري نفس الحساب. ما اتحذفش حاجة.',
    tooMany: 'محاولات كتير. استني دقيقة وجرّبي تاني. ما اتحذفش حاجة.',
    sessionEnded: 'الجلسة انتهت وما قدرناش نأكد النتيجة. سجّلي دخول: لو الحساب لسه موجود، جرّبي الحذف تاني. بياناتك على الجهاز ما اتمسحتش.',
    unavailable: 'خدمة الحذف مش متاحة دلوقتي. ما اتحذفش حاجة. جرّبي كمان شوية.',
    failed: 'حصل خطأ ومقدرناش نكمّل الحذف. ما اتحذفش حاجة من جهازك. جرّبي تاني.',
  },
  localFailed: 'الحساب اتحذف من السيرفر، لكن ماقدرناش نمسح نسخة الجهاز بالكامل. امسحي بيانات التطبيق من إعدادات أندرويد لو عايزة.',
  successTitle: 'تم حذف حسابك',
  successComplete: 'اتحذف حسابك وكل بياناتك وملفاتك من السيرفر، وبيانات الحساب على الجهاز ده، وتم تسجيل خروجك.',
  successPending: 'اتحذف حسابك وبياناتك من السيرفر وتم تسجيل خروجك. لسه بنخلّص مسح بعض الملفات المخزّنة، وده بيكمل تلقائيًا من غير ما تعملي حاجة.',
  done: 'تمام',
  guestTitle: 'إنتي بتستخدمي وضع الضيفة',
  guestBody: 'مفيش حساب علشان يتحذف: كل بياناتك على الجهاز ده بس. تقدري تمسحيها من «مسح بيانات الجهاز» في الإعدادات.',
  backToSettings: 'رجوع للإعدادات',
};

const en: DeleteAccountCopy = {
  title: 'Delete account',
  intro: 'This permanently deletes your Gharzetak account from our server and from this device. Please read the details first.',
  deletesTitle: 'What will be deleted',
  deletes: [
    'Your account: e-mail, name, encrypted password and the Google link.',
    'Your profile: display name, level, terminology, interests, avatar and your tools.',
    'All your projects: parts, stitch and round progress, notes, work sessions and photos.',
    'All your patterns and collections: original text, earlier versions, PDFs and uploaded images.',
    'Favourites, video notes and your store-interest e-mail.',
    'Your Khayoota (AI) consent and your own usage counters.',
    'Every file stored for your account in private storage, and your sign-in sessions on all devices.',
    "This device's copy of your account data, and any sync changes still waiting.",
  ],
  exceptionsTitle: 'What can remain for a limited time',
  exceptions: [
    "Our database provider (Cloudflare) keeps a technical recovery history that ages out automatically — up to 30 days according to its documentation. One account cannot be removed from inside it; it expires on its own.",
    "Short-lived technical request logs at the provider (up to 7 days according to its documentation) that expire automatically.",
    'Khayoota daily usage totals across all users together (aggregate numbers). They are not linked to you and cannot identify you.',
    'Your Google account itself is not deleted — it belongs to Google. Data on other devices signed in to this account is not erased remotely: they will be signed out, and you erase their copy from Settings on that device.',
  ],
  irreversibleTitle: 'This cannot be undone',
  irreversible: 'Deletion is permanent. We cannot restore your account, projects or files afterwards. If you want a copy of anything, save it first.',
  otherDevices: 'If the account is open on another device, it will be signed out on its next request, but the copy stored there stays until you use "Erase data on this device" in Settings.',
  guestUntouched: 'Guest-mode data on this device (if any) is separate and will not be erased.',
  passwordLabel: 'Current password',
  passwordHint: 'We ask so we know you own the account. It is sent encrypted to the server and never stored on this device.',
  googleHint: 'Your account uses Google. If your sign-in is not recent we will ask you to pick your Google account again to confirm you own it.',
  checkingMethod: 'Checking how you sign in…',
  confirmCheck: 'I understand that my account and all my data will be permanently deleted.',
  deleteButton: 'Delete my account permanently',
  deleting: 'Deleting…',
  cancel: 'No, go back',
  offline: 'You are offline. Deleting needs a connection so the server can confirm it.',
  errors: {
    offline: 'We could not reach the server. Nothing was erased from your device. If you retry and see "session ended", sign in: if your password no longer works, the account was deleted.',
    wrongPassword: 'That password is not correct. Nothing was deleted.',
    reauthRequired: 'Your sign-in is too old and Google is not available here. Sign out, sign in again, then try once more. Nothing was deleted.',
    googleCancelled: 'Google account selection was cancelled. Nothing was deleted.',
    googleFailed: 'We could not confirm your Google account. Please try again. Nothing was deleted.',
    otherAccount: 'That is a different Google account from the one you are signed in with. Pick the same account. Nothing was deleted.',
    tooMany: 'Too many attempts. Wait a minute and try again. Nothing was deleted.',
    sessionEnded: 'Your session ended and we could not confirm the result. Sign in: if the account still exists, try deleting again. Your data on this device was not erased.',
    unavailable: 'Deletion is not available right now. Nothing was deleted. Please try again shortly.',
    failed: 'Something went wrong and we could not finish. Nothing was erased from your device. Please try again.',
  },
  localFailed: 'Your account was deleted on the server, but this device could not erase every local copy. You can clear the app data in Android settings.',
  successTitle: 'Your account was deleted',
  successComplete: 'Your account, data and files were deleted from our server, the account data on this device was erased, and you are signed out.',
  successPending: 'Your account and data were deleted from our server and you are signed out. We are still finishing the removal of some stored files; this completes automatically and needs nothing from you.',
  done: 'OK',
  guestTitle: 'You are using guest mode',
  guestBody: 'There is no account to delete: everything is stored on this device only. You can erase it with "Erase data on this device" in Settings.',
  backToSettings: 'Back to Settings',
};

export const DELETE_ACCOUNT_COPY: Readonly<Record<Lang, DeleteAccountCopy>> = { ar, en };
