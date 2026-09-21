/** Module Federation resolves shared singletons asynchronously, so the entry chunk must not import React statically. */
void import('./boot.tsx')
