import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ACTION_LABELS } from './approvalLabels';

function serverFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return serverFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('approval dialog labels', () => {
  it('has a plain-language label for every requireApproval action in the server', () => {
    const actions = new Set<string>();
    for (const f of serverFiles(path.resolve('server/modules'))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/requireApproval\([^)]*?action:\s*'([a-z_.]+)'/gs)) actions.add(m[1]);
    }
    expect(actions.size).toBeGreaterThanOrEqual(13);
    expect([...actions].filter((a) => !ACTION_LABELS[a])).toEqual([]);
  });
});
