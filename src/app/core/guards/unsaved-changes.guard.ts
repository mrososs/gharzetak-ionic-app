import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { I18nService } from '../i18n/i18n.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';

/** Implemented by edit screens that can hold unsaved work. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Pages an editor opens ON TOP of itself and then comes back from (the editor stays alive in the Ionic stack),
 * so going there is not "leaving" and must never ask.
 */
const CHILD_FLOWS = ['/tabs/home/patterns/import'];

/**
 * Leaving an edit screen with unsaved changes (Back button, tab bar, Android hardware Back) asks first.
 * "Keep editing" is the safe default; leaving is the explicit, clearly-labelled destructive choice.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = async (component, _route, _state, nextState) => {
  if (nextState && CHILD_FLOWS.some((p) => nextState.url.startsWith(p))) return true;
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
