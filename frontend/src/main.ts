import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { App } from './app/app';

/** Show a generic startup failure without exposing internal error details. */
function showStartupFailure(): void {
  const appRoot = document.querySelector<HTMLElement>('app-root');

  if (appRoot !== null) {
    appRoot.textContent = 'No fue posible iniciar la aplicación.';
  }
}

void bootstrapApplication(App, appConfig).catch(showStartupFailure);
