import { CAT, Tone } from '../core/data/catalog';
import { photo } from '../core/data/photos';
import { I18nService } from '../core/i18n/i18n.service';
import { Project } from '../core/models/models';
import { AppStore } from '../core/state/app.store';

export interface ProjectCardVm {
  readonly id: string;
  readonly name: string;
  readonly tone: Tone;
  readonly img: string;
  readonly storagePath: string | null;
  readonly alt: string;
  readonly pct: number;
  readonly roundLabel: string;
  readonly lastText: string;
  readonly catName: string;
  readonly stName: string;
  readonly stCls: string;
}

/** Shared view-model for project cards (home hero, previous projects, list, picker). */
export function projectCard(store: AppStore, i18n: I18nService, p: Project): ProjectCardVm {
  const cat = CAT[p.category] ?? CAT.amigurumi;
  const pr = store.progress(p);
  return {
    id: p.id,
    name: p.name,
    tone: cat.tone,
    img: p.coverLocalUrl || (p.coverPath ? '' : photo('cat_' + p.category)),
    storagePath: p.coverLocalUrl ? null : p.coverPath,
    alt: i18n.isAr() ? cat.altAr : cat.altEn,
    pct: pr.pct,
    roundLabel: pr.roundLabel,
    lastText: store.relTime(p.lastWorkedAt),
    catName: store.categoryName(p.category),
    stName: store.statusName(p.status),
    stCls: store.statusClass(p.status),
  };
}
