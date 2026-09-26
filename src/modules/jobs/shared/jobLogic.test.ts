import { describe, it, expect } from 'vitest';
import { dueTone, jobMoves, localIsoDate, visibleLanes } from './jobLogic';

const now = new Date(2030, 2, 10, 21, 30); // 10 Mar 2030, 9:30 pm local

describe('dueTone', () => {
  it('grades a due date against the local day', () => {
    expect(localIsoDate(now)).toBe('2030-03-10');
    expect(dueTone(null, now)).toBe('none');
    expect(dueTone('2030-03-09', now)).toBe('overdue');
    expect(dueTone('2030-03-10', now)).toBe('today');
    expect(dueTone('2030-03-12', now)).toBe('soon');
    expect(dueTone('2030-03-13', now)).toBe('later');
  });
});

describe('jobMoves', () => {
  it('converts quotes: proof jobs to Approved, simple quotes to an order', () => {
    expect(jobMoves({ status: 'quote', useProofFlow: true })).toEqual({ back: null, forward: { to: 'approved', label: 'Approve', convert: true } });
    expect(jobMoves({ status: 'quote', useProofFlow: false }).forward).toMatchObject({ to: 'acknowledged', convert: true });
  });
  it('steps along the job’s own path, one at a time', () => {
    expect(jobMoves({ status: 'acknowledged', useProofFlow: false })).toEqual({ back: null, forward: { to: 'in_progress', label: 'In Progress', convert: false } });
    expect(jobMoves({ status: 'design', useProofFlow: true })).toMatchObject({ back: 'approved', forward: { to: 'in_progress' } });
    expect(jobMoves({ status: 'picked_up', useProofFlow: false })).toEqual({ back: 'done', forward: null });
  });
});

describe('visibleLanes', () => {
  it('shows the proof lanes only while a job is in one', () => {
    expect(visibleLanes({ acknowledged: 3 })).toEqual(['acknowledged', 'in_progress', 'done', 'picked_up']);
    expect(visibleLanes({ design: 1 })).toEqual(['quote', 'approved', 'design', 'acknowledged', 'in_progress', 'done', 'picked_up']);
  });
});
