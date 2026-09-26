import { describe, it, expect } from 'vitest';
import { Navigate } from 'react-router-dom';
import { ROUTES } from './routes';

const route = (path: string) => ROUTES.find((r) => r.path === path);

describe('route table', () => {
  it('/pos goes to Payments until the counter page exists; the placeholder lives at /pos/counter', () => {
    const pos = route('/pos')!.element as { type: unknown; props: { to: string } };
    expect(pos.type).toBe(Navigate);
    expect(pos.props.to).toBe('/payments');
    expect(route('/pos/counter')).toBeDefined();
    expect(route('/payments')).toBeDefined();
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
