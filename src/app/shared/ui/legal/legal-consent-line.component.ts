import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { legalUrl } from '../../../core/legal/legal-links';

/**
 * "By continuing you agree to the Terms and the Privacy Policy" with real links. Rendered only when the public legal pages are
 * configured (GZ_LEGAL_BASE_URL): a sentence pointing at pages that do not exist would be worse than no sentence.
 */
@Component({
  selector: 'gz-legal-consent-line',
  template: `
    @if (links(); as l) {
      <p class="gz-xs gz-mute mt-3 mb-0" data-testid="legal-consent">
        {{ i18n.q('بمتابعتك إنتي بتوافقي على', 'By continuing you agree to the') }}
        <a [href]="l.terms" target="_blank" rel="noopener noreferrer" data-testid="legal-consent-terms">{{ i18n.q('الشروط والأحكام', 'Terms & Conditions') }}</a>
        {{ i18n.q('و', 'and') }}
        <a [href]="l.privacy" target="_blank" rel="noopener noreferrer" data-testid="legal-consent-privacy">{{ i18n.q('سياسة الخصوصية', 'Privacy Policy') }}</a>.
      </p>
    }
  `,
  styles: `
    a {
      color: var(--gz-primary, #813db5);
      text-decoration: underline;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalConsentLineComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly links = computed(() => {
    const lang = this.i18n.lang();
    const terms = legalUrl('terms', lang);
    const privacy = legalUrl('privacy', lang);
    return terms && privacy ? { terms, privacy } : null;
  });
}
