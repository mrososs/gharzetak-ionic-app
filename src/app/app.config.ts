import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular({ backButtonText: '', swipeBackEnabled: true, innerHTMLTemplatesEnabled: false }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    // Restore the cached session (offline-capable) before the first navigation so guards see it.
    provideAppInitializer(() => inject(AuthService).init()),
  ],
};
