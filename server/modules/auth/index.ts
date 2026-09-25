// Auth module interface (ADR 0004): sign-in/session routes, the root auth
// hook, and the two permission checks every other module uses —
// requireRole (configuration) and requireApproval (money/override actions).
export { authRoutes, PIN_PATTERN } from './routes.js';
export {
  authHook, requireRole, requireApproval, approvalSchema, revokeUserSessions,
  activeAdminCount, upgradePlaintextPasswords, hashPin, verifyCredentials,
  createSession, resetRateLimits, atLeast,
  SESSION_IDLE_MS, SESSION_ABSOLUTE_MS,
  type AuthUser, type ApprovalRequest, type Approver,
} from './service.js';
export { verifyPin } from './crypto.js';
