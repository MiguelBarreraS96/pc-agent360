import { Routes } from '@angular/router';

import { adminPermissionGuard, authGuard, guestGuard, permissionGuard } from './core/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Acceso | Agente 360',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.component').then((module) => module.LoginComponent),
  },
  {
    path: 'auth/email-link',
    title: 'Confirmar acceso | Agente 360',
    loadComponent: () =>
      import('./features/auth/email-link-callback.component').then((module) => module.EmailLinkCallbackComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () => import('./features/shell/shell.component').then((module) => module.ShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'agent',
      },
      {
        path: 'agent',
        title: 'Agente IA | Agente 360',
        data: { heading: 'Agente IA', subheading: 'Consulta información de clientes en lenguaje natural' },
        canActivate: [permissionGuard('agent:read')],
        loadComponent: () => import('./features/agent/agent.component').then((module) => module.AgentComponent),
      },
      {
        path: 'consulta360',
        title: 'Consulta Cliente 360 | Agente 360',
        data: {
          heading: 'Consulta Cliente 360',
          subheading: 'Consulta información de clientes por documento',
        },
        canActivate: [permissionGuard('agent:read')],
        loadComponent: () =>
          import('./features/consulta360/consulta360').then((module) => module.Consulta360Component),
      },
      {
        path: 'correos-conectados',
        title: 'Correos conectados | Agente 360',
        data: { heading: 'Correos conectados', subheading: 'Administra las cuentas con acceso a la plataforma' },
        canActivate: [adminPermissionGuard('users:read')],
        loadComponent: () =>
          import('./features/admin/connected-emails.component').then((module) => module.ConnectedEmailsComponent),
      },
      {
        path: 'productos',
        title: 'Productos | Agente 360',
        data: { heading: 'Productos', subheading: 'Catálogo de productos disponibles' },
        canActivate: [adminPermissionGuard('products:read')],
        loadComponent: () => import('./features/admin/products.component').then((module) => module.ProductsComponent),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'agent',
  },
];
