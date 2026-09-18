/**
 * Async boundary.
 *
 * Module Federation resolves shared singletons asynchronously, so the entry
 * chunk must not import React statically — `loadShareSync` throws if it does.
 * One dynamic import is the whole fix.
 */
void import('./boot.tsx')
