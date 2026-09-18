import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { createAppConfig } from './app/app.config';
import { loadRuntimeConfig } from './app/core/runtime-config.loader';

/** Load public configuration before constructing providers that depend on it. */
async function bootstrap(): Promise<void> {
  const runtimeConfig = await loadRuntimeConfig();
  await bootstrapApplication(App, createAppConfig(runtimeConfig));
}

/** Show a generic startup failure without exposing configuration or provider details. */
function showStartupFailure(): void {
  const appRoot = document.querySelector<HTMLElement>('app-root');

  if (appRoot !== null) {
    appRoot.textContent = 'No fue posible iniciar la aplicación.';
  }
}

void bootstrap().catch(showStartupFailure);
