import { describe, it, expect } from 'vitest';
import { perfDbPathProblem } from './perf-guard.js';

describe('perfDbPathProblem', () => {
  it('rejects an unset or blank DB_PATH', () => {
    expect(perfDbPathProblem(undefined)).toMatch(/not set/);
    expect(perfDbPathProblem('  ')).toMatch(/not set/);
  });
  it('rejects the production filename anywhere in the path', () => {
    expect(perfDbPathProblem('./data/dp-erp.db')).toMatch(/production/);
    expect(perfDbPathProblem('/srv/backup/dp-erp.db-copy')).toMatch(/production/);
  });
  it('accepts an explicit non-production path', () => {
    expect(perfDbPathProblem('./data/perf-test.db')).toBeNull();
    expect(perfDbPathProblem('/tmp/perf-test.db')).toBeNull();
  });
});
