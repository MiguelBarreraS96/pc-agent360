import { Routes } from '@angular/router';

import { adminPermissionGuard, authGuard, guestGuard, permissionGuard } from './core/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Acceso | Olivia',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.component').then((module) => module.LoginComponent),
  },
  {
    path: 'auth/email-link',
    title: 'Confirmar acceso | Olivia',
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
        title: 'Agente Olivia | Olivia',
        data: { heading: 'Agente Olivia', subheading: 'Consulta información de clientes en lenguaje natural' },
        canActivate: [permissionGuard('agent:read')],
        loadComponent: () => import('./features/agent/agent.component').then((module) => module.AgentComponent),
      },
      {
        path: 'correos-conectados',
        title: 'Correos conectados | Olivia',
        data: { heading: 'Correos conectados', subheading: 'Administra las cuentas con acceso a la plataforma' },
        canActivate: [adminPermissionGuard('users:read')],
        loadComponent: () =>
          import('./features/admin/connected-emails.component').then((module) => module.ConnectedEmailsComponent),
      },
      {
        path: 'productos',
        title: 'Productos | Olivia',
        data: { heading: 'Productos', subheading: 'Catálogo de productos disponibles' },
        canActivate: [adminPermissionGuard('products:read')],
        loadComponent: () => import('./features/admin/products.component').then((module) => module.ProductsComponent),
      },
      {
        path: 'consultas',
        title: 'Consultas | Olivia',
        data: { heading: 'Consultas', subheading: 'Consultas de Cliente 360 por rango de fechas' },
        canActivate: [adminPermissionGuard('reports:read')],
        loadComponent: () =>
          import('./features/admin/consultations-report.component').then((module) => module.ConsultationsReportComponent),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'agent',
  },
];
