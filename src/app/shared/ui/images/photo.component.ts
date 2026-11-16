import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { IconName } from '../../../core/data/icons';
import { Tone } from '../../../core/data/catalog';
import { SyncService } from '../../../core/sync/sync.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Photo slot (prototype "CrochetImage" pattern): a labelled tonal placeholder with the real
 * image layered on top. If the image fails to load, the placeholder stays visible.
 * `src` = local/bundled URL; `storagePath` = private Supabase object (resolved to a signed URL).
 */
@Component({
  selector: 'gz-photo',
  imports: [IconComponent],
  template: `
    <div [class]="'gz-ph t-' + tone() + ' ' + extraClass()" [style.height]="height()" [style.width]="width()">
      @if (icon(); as ic) {
        <svg [gzIcon]="ic" [size]="iconSize()" />
      }
      @if (showLabel() && alt()) {
        <span class="pl" aria-hidden="true">{{ alt() }}</span>
      }
      <ng-content />
      @if (resolved(); as url) {
        @if (!failed()) {
          <img [src]="url" [alt]="alt()" loading="lazy" decoding="async" (error)="failed.set(true)" />
        }
      }
    </div>
  `,
  styles: `:host { display: block; } :host .gz-ph { width: 100%; height: 100%; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoComponent {
  private readonly sync = inject(SyncService);
  readonly tone = input<Tone>('lav');
  readonly src = input<string | null | undefined>(null);
  readonly storagePath = input<string | null | undefined>(null);
  readonly alt = input('');
  readonly icon = input<IconName | null>('image');
  readonly iconSize = input<'' | 's' | 'l' | 'xl'>('');
  readonly showLabel = input(true);
  readonly height = input<string | null>(null);
  readonly width = input<string | null>(null);
  readonly extraClass = input('');

  protected readonly failed = signal(false);
  private readonly signedUrl = signal<string | null>(null);
  protected readonly resolved = computed(() => this.src() || this.signedUrl());

  constructor() {
    effect(() => {
      this.failed.set(false);
      const path = this.storagePath();
      if (this.src() || !path) {
        this.signedUrl.set(null);
        return;
      }
      void this.sync.signedUrl(path).then((u) => this.signedUrl.set(u));
    });
  }
}
