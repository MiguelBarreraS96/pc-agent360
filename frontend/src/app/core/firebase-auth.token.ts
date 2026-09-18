import { InjectionToken } from '@angular/core';
import { Auth } from 'firebase/auth';

/** Provides Firebase Auth configured exclusively with in-memory persistence. */
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');
