import { describe, it, expect } from 'vitest';
import { Navigate } from 'react-router-dom';
import { ROUTES, NAV } from './routes';

const route = (path: string) => ROUTES.find((r) => r.path === path);

describe('route table', () => {
  it('/pos is the counter sale; the old placeholder URL redirects there', () => {
    expect((route('/pos')!.element as { type: unknown }).type).not.toBe(Navigate);
    const old = route('/pos/counter')!.element as { type: unknown; props: { to: string } };
    expect(old.type).toBe(Navigate);
    expect(old.props.to).toBe('/pos');
    for (const p of ['/pos/drawer', '/pos/drawer/:id', '/pos/invoices', '/pos/invoices/:number', '/pos/returns', '/pos/returns/new', '/pos/returns/:id', '/payments']) {
      expect(route(p), p).toBeDefined();
    }
  });

  it('the nav has POS at /pos and keeps Payments', () => {
    expect(NAV.find((n) => n.label === 'POS')?.to).toBe('/pos');
    expect(NAV.find((n) => n.label === 'Payments')?.to).toBe('/payments');
  });

  it('Quick Order is retired: /quick redirects to /pos and the nav drops it (D15)', () => {
    const el = route('/quick')!.element as { type: unknown; props: { to: string } };
    expect(el.type).toBe(Navigate);
    expect(el.props.to).toBe('/pos');
    expect(NAV.find((n) => n.label === 'Quick Order')).toBeUndefined();
    expect(NAV.some((n) => n.to === '/quick')).toBe(false);
  });
});

describe('admin routes', () => {
  it('old /materials and /taxonomy URLs redirect to their Settings homes', () => {
    for (const [from, to] of [['/materials', '/settings/materials'], ['/taxonomy', '/settings/taxonomy']]) {
      const el = route(from)!.element as { type: unknown; props: { to: string } };
      expect(el.type).toBe(Navigate);
      expect(el.props.to).toBe(to);
    }
  });
  it('every settings sub-page, reports, audit and the customer pages are routed', () => {
    for (const p of ['/settings', '/settings/users', '/settings/shop', '/settings/materials', '/settings/taxonomy',
      '/settings/suppliers', '/settings/locations', '/reports', '/audit', '/customers', '/customers/:id']) {
      expect(route(p), p).toBeDefined();
    }
  });
});
