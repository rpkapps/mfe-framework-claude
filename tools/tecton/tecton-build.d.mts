/** Types for the plain-JavaScript helper beside this file. */

export declare function tectonIsPresent(packageRoot: string): boolean
export declare function requireTecton(packageRoot: string, consumer?: string): void
export declare function useWorkspaceModules(packageRoot: string): void
export declare function tectonResolve(packageRoot: string): { modules: string[] }
