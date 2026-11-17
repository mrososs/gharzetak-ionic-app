import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { appGuard, signedOutGuard } from './core/auth/guards';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

/** Screen ↔ route map: docs/design-handoff/screen-map.md */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => (inject(AuthService).canEnterApp() ? '/tabs/home' : '/onboarding/welcome'),
  },
  {
    path: 'onboarding',
    canActivate: [signedOutGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'welcome' },
      { path: ':slide', loadComponent: () => import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage) },
    ],
  },
  {
    path: 'auth',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      { path: 'login', canActivate: [signedOutGuard], data: { mode: 'login' }, loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage) },
      { path: 'signup', canActivate: [signedOutGuard], data: { mode: 'signup' }, loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage) },
      { path: 'forgot', canActivate: [signedOutGuard], loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage) },
      { path: 'reset', loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage) },
    ],
  },
  {
    path: 'setup',
    canMatch: [appGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'avatar' },
      { path: ':step', loadComponent: () => import('./features/onboarding/setup.page').then((m) => m.SetupPage) },
    ],
  },
  {
    path: 'tabs',
    canMatch: [appGuard],
    loadComponent: () => import('./layout/tabs-layout/tabs.layout').then((m) => m.TabsLayout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
      { path: 'home/settings', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
      { path: 'home/achievements', loadComponent: () => import('./features/achievements/achievements.page').then((m) => m.AchievementsPage) },
      { path: 'home/store', loadComponent: () => import('./features/store/store.page').then((m) => m.StorePage) },
      { path: 'home/patterns', loadComponent: () => import('./features/patterns/pattern-library.page').then((m) => m.PatternLibraryPage) },
      { path: 'home/patterns/new', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/patterns/add-pattern.page').then((m) => m.AddPatternPage) },
      { path: 'home/patterns/import', loadComponent: () => import('./features/patterns/smart-import.page').then((m) => m.SmartImportPage) },
      { path: 'home/patterns/:id/edit', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/patterns/add-pattern.page').then((m) => m.AddPatternPage) },
      { path: 'home/collections/new', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/patterns/collection-editor.page').then((m) => m.CollectionEditorPage) },
      { path: 'home/collections/:id/edit', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/patterns/collection-editor.page').then((m) => m.CollectionEditorPage) },
      { path: 'home/collections/:id', loadComponent: () => import('./features/patterns/collection-detail.page').then((m) => m.CollectionDetailPage) },
      { path: 'home/patterns/:id', loadComponent: () => import('./features/patterns/pattern-reader.page').then((m) => m.PatternReaderPage) },
      { path: 'home/terms', loadComponent: () => import('./features/terminology/terminology.page').then((m) => m.TerminologyPage) },
      { path: 'projects', loadComponent: () => import('./features/projects/projects.page').then((m) => m.ProjectsPage) },
      { path: 'projects/new', canDeactivate: [unsavedChangesGuard], loadComponent: () => import('./features/projects/new-project.page').then((m) => m.NewProjectPage) },
      { path: 'projects/:id', loadComponent: () => import('./features/projects/project-detail.page').then((m) => m.ProjectDetailPage) },
      { path: 'tracker', loadComponent: () => import('./features/tracker/tracker.page').then((m) => m.TrackerPage) },
      { path: 'learn', loadComponent: () => import('./features/learning/learn.page').then((m) => m.LearnPage) },
      { path: 'learn/:id', loadComponent: () => import('./features/video-tutorials/video-detail.page').then((m) => m.VideoDetailPage) },
      { path: 'assistant', loadComponent: () => import('./features/ai-assistant/assistant.page').then((m) => m.AssistantPage) },
    ],
  },
  { path: 'design-system', loadComponent: () => import('./features/design-system/design-system.page').then((m) => m.DesignSystemPage) },
  { path: '**', redirectTo: '' },
];
