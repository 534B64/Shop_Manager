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
