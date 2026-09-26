import { hasRole, type Role } from '../lib/session';

// Hides role-restricted content (replaced the shared-password AdminGate,
// ADR 0004). Convenience only — the server enforces every role check.
export default function RoleGate({ min, children, quiet }: { min: Role; children: React.ReactNode; quiet?: boolean }) {
  if (hasRole(min)) return <>{children}</>;
  if (quiet) return null;
  return (
    <div className="bg-surface border border-outline-variant rounded-shape-medium p-5 max-w-md">
      <h2 className="text-title-large text-on-surface mb-2">{min === 'admin' ? 'Admin' : 'Manager'} area</h2>
      <p className="text-body-medium text-on-surface-variant">Pricing and configuration need a {min} account. Ask the owner to sign in, or to change your role in Settings → Accounts.</p>
    </div>
  );
}
