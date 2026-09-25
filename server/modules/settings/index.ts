// Settings module interface (ADR 0003): routes + the shared reads other
// modules are allowed to use, including the admin gate.
export { settingsRoutes } from './routes.js';
export { getSetting, setSetting, requireAdmin, taxRatePct } from './service.js';
