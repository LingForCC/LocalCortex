/// <reference types="vite/client" />

// Vite's `?raw` suffix imports a file's contents as a string. The vite/client
// types declare modules for "*?raw" — this reference pulls them in so tsc
// accepts the migration SQL imports in src/main/db/migrate.ts.
