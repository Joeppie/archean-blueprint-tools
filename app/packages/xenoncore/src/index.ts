// index.ts — the xenoncore public surface (P10-S1 seed, REWRITE § P10).
// The analysis cluster (project model, analyzer, reference docs, program
// sites) moved out of app/src/engine VERBATIM; codec.ts is the new S4 seed:
// the craft ⇄ workspace decompose/pack core. Everything here is pure TS:
// no React, no three.js, no DOM, no machine paths — the boundary that lets
// S0 lift this folder into its own repo with the app (and later the VS Code
// extension + the MCP bin) as pure consumers.

export * from './xcproject';
export * from './xcanalyze';
export * from './xcdocs';
export * from './xcsites';
export * from './codec';
