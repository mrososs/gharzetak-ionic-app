import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { I18nService } from '../i18n/i18n.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';

/** Implemented by edit screens that can hold unsaved work. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Leaving an edit screen with unsaved changes (Back button, tab bar, Android hardware Back) asks first.
 * "Keep editing" is the safe default; leaving is the explicit, clearly-labelled destructive choice.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = async (component) => {
  if (!component.hasUnsavedChanges()) return true;
  const i18n = inject(I18nService);
  const ui = inject(UiFeedback);
  return ui.confirm(
    i18n.q('تغييرات غير محفوظة', 'Unsaved changes'),
    i18n.q('لو خرجتي دلوقتي هتضيع التعديلات اللي ما اتحفظتش.', 'If you leave now, the changes you have not saved will be lost.'),
    i18n.q('تجاهلي التعديلات', 'Discard changes'),
    true,
    i18n.q('كمّلي التعديل', 'Keep editing'),
  );
};
