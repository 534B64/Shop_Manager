// Settings module interface (ADR 0003): routes + the shared reads other
// modules are allowed to use. The admin gate moved to modules/auth (ADR 0004).
export { settingsRoutes } from './routes.js';
export { getSetting, setSetting, taxRatePct, posSettings, DEFAULT_POS_SETTINGS } from './service.js';
export { getCompanyName, ensureCompanyName, COMPANY_KEY } from './company.js';
