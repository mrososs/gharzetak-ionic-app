import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppStore } from '../../core/state/app.store';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { NewProjectPage } from './new-project.page';

/**
 * Regression: Ionic re-activates the cached page instance, so a discarded draft's cover photo (and text) reappeared in the next
 * "new project" and was saved + uploaded with it.
 */
describe('NewProjectPage draft state', () => {
  const calls: string[] = [];
  const added: { name: string; coverLocalUrl: string | null }[] = [];

  function page() {
    TestBed.resetTestingModule();
    calls.length = 0;
    added.length = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: NavController, useValue: { navigateRoot: async (u: string) => void calls.push(u), back: () => undefined } },
        { provide: UiFeedback, useValue: { say: async () => undefined, toast: async () => undefined } },
        {
          provide: AppStore,
          useValue: {
            profile: () => ({ level: 'beginner', terms: 'us' }),
            addPattern: async () => undefined,
            addProject: async (p: { name: string; coverLocalUrl: string | null }) => void added.push(p),
          },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new NewProjectPage()) as unknown as {
      form: { getRawValue(): { name: string; target: number; pattern: string }; patchValue(v: object): void };
      cover: { (): string | null; set(v: string | null): void };
      ionViewWillEnter(): void;
      save(): Promise<void>;
    };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('a discarded draft (cover, name, pattern) is gone when the form is entered again', () => {
    const p = page();
    p.form.patchValue({ name: 'Draft', target: 24, pattern: 'R1: 6sc [6]' });
    p.cover.set('data:image/jpeg;base64,AAAA');

    p.ionViewWillEnter(); // Ionic re-activating the cached instance

    expect(p.cover()).toBeNull();
    expect(p.form.getRawValue()).toMatchObject({ name: '', target: 0, pattern: '' });
  });

  it('the next project never inherits the previous project cover', async () => {
    const p = page();
    p.ionViewWillEnter();
    p.form.patchValue({ name: 'First' });
    p.cover.set('data:image/jpeg;base64,PRIVATE');
    await p.save();
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: 'First', coverLocalUrl: 'data:image/jpeg;base64,PRIVATE' });

    // same cached instance, opened again
    p.ionViewWillEnter();
    p.form.patchValue({ name: 'Second' });
    await p.save();
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ name: 'Second', coverLocalUrl: null });
  });

  it('even without re-entering, a saved form is cleared so the cover cannot leak', async () => {
    const p = page();
    p.form.patchValue({ name: 'Saved' });
    p.cover.set('data:image/jpeg;base64,PRIVATE');
    await p.save();
    expect(p.cover()).toBeNull();
    expect(p.form.getRawValue().name).toBe('');
  });
});
