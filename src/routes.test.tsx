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
});
