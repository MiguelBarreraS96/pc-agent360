import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/home/home').then((module) => module.HomeComponent),
  },
  {
    path: 'consulta360',
    loadComponent: () =>
      import('./features/consulta360/consulta360').then((module) => module.Consulta360Component),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
