import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { Lang } from '../data/catalog';
import { STRINGS, Strings } from './strings';

const LANG_KEY = 'gz.lang';

/** Language + direction. Arabic (RTL) is the default; English is LTR. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly doc = inject(DOCUMENT);
  readonly lang = signal<Lang>(readLang());
  readonly isAr = computed(() => this.lang() === 'ar');
  readonly dir = computed(() => (this.isAr() ? 'rtl' : 'ltr'));
  readonly t = computed<Strings>(() => STRINGS[this.lang()]);

  constructor() {
    effect(() => {
      const lang = this.lang();
      const html = this.doc.documentElement;
      html.lang = lang;
      html.dir = lang === 'ar' ? 'rtl' : 'ltr';
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* private mode: keep in memory */
      }
    });
  }

  toggle(): void {
    this.lang.update((l) => (l === 'ar' ? 'en' : 'ar'));
  }

  /** Pick the Arabic or English variant. */
  q(ar: string, en: string): string {
    return this.isAr() ? ar : en;
  }

  /** Simple {n} interpolation. */
  fmt(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  }
}

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}
