/**
 * The one module an Angular container imports the framework through. Discovery reads definitions
 * and route data only when they come from it, the generated `#mfe/fetch` imports its transport
 * from it, and the sharing policy follows its own dependencies.
 */
export const ANGULAR_ADAPTER = '@company/mfe-angular'
