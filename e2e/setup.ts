import '@angular/compiler';
import { Blob as NodeBlob } from 'node:buffer';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { environment } from '../src/environments/environment';

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(environment.apiUrl)) {
  throw new Error(`e2e refuses to run against ${environment.apiUrl || '(no GZ_API_URL)'}: set GZ_API_URL=http://localhost:8787 in .env and run \`npm run api:dev\``);
}
// Browsers and Capacitor WebViews always send an Origin header on cross-origin requests; Node's fetch does not.
// Emulate the Ionic dev origin so the API's origin allow-list is exercised exactly as in the app.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Origin')) headers.set('Origin', 'http://localhost:4200');
  return realFetch(input, { ...init, headers });
}) as typeof fetch;

// jsdom has no URL.createObjectURL: keep created blobs in a map the tests can inspect.
const blobs = new Map<string, Blob>();
(globalThis as unknown as { __blobs: Map<string, Blob> }).__blobs = blobs;
URL.createObjectURL = (b: Blob | MediaSource) => {
  const u = `blob:http://localhost:4200/${crypto.randomUUID()}`;
  blobs.set(u, b as Blob);
  return u;
};
URL.revokeObjectURL = (u: string) => void blobs.delete(u);

// jsdom's Blob is not understood by Node's fetch (it would be sent as "[object Blob]"); real browsers have one Blob.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
