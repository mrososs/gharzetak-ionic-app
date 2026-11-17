import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderService } from '../../../core/reminders/reminder.service';
import { SheetComponent } from '../dialogs/sheet.component';
import { ReminderSoftAskComponent } from './reminder-soft-ask.component';

type Result = 'granted' | 'denied' | 'unsupported';

/** A fake service whose enable() can be settled by the test, so the "request in flight" moment can be observed. */
class FakeReminders {
  readonly softAsk = signal(true);
  readonly nextAt = signal<number | null>(null);
  readonly closed: string[] = [];
  private settle: (r: Result) => void = () => undefined;
  enable = vi.fn(() => new Promise<Result>((resolve) => (this.settle = resolve)));
  resolveEnable(r: Result): void {
    this.settle(r);
  }
  closeSoftAsk(): void {
    this.closed.push('close');
    this.softAsk.set(false);
  }
  replan = vi.fn(async () => undefined);
  openSystemSettings = vi.fn();
}

describe('<gz-reminder-soft-ask>', () => {
  let fake: FakeReminders;
  let fixture: ReturnType<typeof TestBed.createComponent<ReminderSoftAskComponent>>;
  let comp: { yes(): Promise<void>; busy(): boolean; result(): string | null };

  beforeEach(() => {
    localStorage.clear();
    fake = new FakeReminders();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: ReminderService, useValue: fake }] });
    fixture = TestBed.createComponent(ReminderSoftAskComponent);
    fixture.detectChanges();
    comp = fixture.componentInstance as unknown as typeof comp;
  });
  afterEach(() => TestBed.resetTestingModule());

  /**
   * Regression for a bug found on a real phone: gz-sheet refuses to be dismissed while it is "busy", and this component closes the
   * sheet right after enable() resolves — while still busy. The close was silently ignored and the sheet stayed open after the
   * reminders were already switched on. The sheet must therefore never be told it is busy.
   */
  it('never locks the sheet while the permission request is running', async () => {
    const sheet = fixture.debugElement.query(By.directive(SheetComponent)).componentInstance as SheetComponent;
    const pending = comp.yes();
    fixture.detectChanges();
    expect(comp.busy()).toBe(true); // the buttons are disabled…
    expect(sheet.busy()).toBe(false); // …but the sheet itself stays dismissible
    fake.resolveEnable('granted');
    await pending;
    expect(fake.closed).toEqual(['close']); // closed after a successful enable
    expect(fake.softAsk()).toBe(false);
    expect(comp.busy()).toBe(false);
  });

  it('keeps the sheet open and explains when the permission was denied', async () => {
    const pending = comp.yes();
    fake.resolveEnable('denied');
    await pending;
    expect(comp.result()).toBe('denied');
    expect(fake.closed).toEqual([]);
    expect(fake.replan).not.toHaveBeenCalled();
  });

  it('says so on the web instead of failing', async () => {
    const pending = comp.yes();
    fake.resolveEnable('unsupported');
    await pending;
    expect(comp.result()).toBe('unsupported');
    expect(fake.closed).toEqual([]);
  });
});
