import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { legalUrl } from '../../core/legal/legal-links';
import { SUPPORT_EMAIL, supportMailto } from '../../core/legal/support';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/**
 * Settings → Privacy & account: the public legal pages (one configured base URL, never a hard-coded domain), the official support
 * mailbox, and, for a signed-in user only, the in-app Delete account flow. Guests have no account, so they see no delete action.
 */
@Component({
  selector: 'gz-privacy-account',
  imports: [IconComponent],
  template: `
    <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('الخصوصية والحساب', 'Privacy & account') }}</h2></div>
    @for (l of legalRows(); track l.id) {
      @if (l.url) {
        <a class="gz-btn3 w mt-2" [href]="l.url" target="_blank" rel="noopener noreferrer" [attr.data-testid]="'legal-' + l.id"><svg gzIcon="info" size="s" />{{ l.label }}</a>
      } @else {
        <button type="button" class="gz-btn3 w mt-2" disabled aria-disabled="true" [attr.data-testid]="'legal-' + l.id">
          {{ l.label }} <span class="gz-badge">{{ i18n.q('لسه مش منشورة', 'Not published yet') }}</span>
        </button>
      }
    }
    <a class="gz-btn3 w mt-2" [href]="mailto()" data-testid="support-mail"><svg gzIcon="mail" size="s" />{{ i18n.q('تواصل مع الدعم', 'Contact support') }}</a>
    <p class="gz-xs gz-mute" style="margin: 6px 2px 0">
      {{ i18n.q('البريد الرسمي للدعم والخصوصية وطلبات حذف الحساب:', 'Official e-mail for support, privacy and account-deletion requests:') }}
      <span dir="ltr" class="gz-b" data-testid="support-address">{{ email }}</span>
    </p>
    @if (auth.signedIn()) {
      <button type="button" class="gz-btn3 rose w mt-2" data-testid="settings-delete-account" (click)="nav.navigateForward('/tabs/home/settings/delete-account')">
        <svg gzIcon="trash" size="s" />{{ i18n.q('حذف الحساب', 'Delete account') }}
      </button>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyAccountSectionComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  protected readonly nav = inject(NavController);
  protected readonly email = SUPPORT_EMAIL;
  protected readonly mailto = computed(() => supportMailto('support', this.i18n.lang()));

  /** Privacy policy, terms and the web account-deletion page. `url` is null until GZ_LEGAL_BASE_URL is configured (see core/legal). */
  protected readonly legalRows = computed(() => {
    const lang = this.i18n.lang();
    return [
      { id: 'privacy', label: this.i18n.q('سياسة الخصوصية', 'Privacy Policy'), url: legalUrl('privacy', lang) },
      { id: 'terms', label: this.i18n.q('الشروط والأحكام', 'Terms & Conditions'), url: legalUrl('terms', lang) },
      { id: 'delete-account', label: this.i18n.q('معلومات حذف الحساب (على الويب)', 'Account deletion information (web)'), url: legalUrl('delete-account', lang) },
    ];
  });
}
