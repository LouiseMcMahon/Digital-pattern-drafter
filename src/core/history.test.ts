import { describe, expect, it } from 'vitest';
import { History } from './history';

type S = { n: number[] };
const copy = (s: S): S => ({ n: [...s.n] });
const make = (limit?: number) => new History<S>(copy, limit);

describe('History', () => {
  it('starts with nothing to undo or redo, and answers undefined', () => {
    const h = make();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo({ n: [1] })).toBeUndefined();
    expect(h.redo({ n: [1] })).toBeUndefined();
    expect(h.canRedo).toBe(false); // a failed undo leaves nothing to redo
    expect(h.canUndo).toBe(false);
  });

  it('undo returns the recorded state, redo returns the one undone from', () => {
    const h = make();
    h.record({ n: [1] });
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(h.undo({ n: [1, 2] })).toEqual({ n: [1] });
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo({ n: [1] })).toEqual({ n: [1, 2] });
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  it('steps back through several edits in reverse order, and forward again', () => {
    const h = make();
    h.record({ n: [] });
    h.record({ n: [1] });
    h.record({ n: [1, 2] });
    let now: S = { n: [1, 2, 3] };
    const seen: number[][] = [];
    for (let k = 0; k < 3; k++) { now = h.undo(now)!; seen.push(now.n); }
    expect(seen).toEqual([[1, 2], [1], []]);
    expect(h.undo(now)).toBeUndefined();
    const forward: number[][] = [];
    for (let k = 0; k < 3; k++) { now = h.redo(now)!; forward.push(now.n); }
    expect(forward).toEqual([[1], [1, 2], [1, 2, 3]]);
  });

  it('a new edit after an undo ends the redo branch', () => {
    const h = make();
    h.record({ n: [] });
    const back = h.undo({ n: [1] })!;
    expect(h.canRedo).toBe(true);
    h.record(back);
    expect(h.canRedo).toBe(false);
    expect(h.redo({ n: [9] })).toBeUndefined();
  });

  it('keeps copies: editing a state after recording, or one it returned, does not reach the history', () => {
    const h = make();
    const s: S = { n: [1] };
    h.record(s);
    s.n.push(99);
    const undone = h.undo({ n: [5] })!;
    expect(undone).toEqual({ n: [1] });
    undone.n.push(77);
    const current: S = { n: [5] };
    const redone = h.redo(undone)!;
    expect(redone).toEqual({ n: [5] });
    current.n.push(1);
    redone.n.push(2);
    expect(h.undo({ n: [0] })).toEqual({ n: [1, 77] }); // undo stored a copy of `undone` as it was handed over: [1, 77]
  });

  it('the state handed to undo is kept as a copy for redo', () => {
    const h = make();
    h.record({ n: [1] });
    const current: S = { n: [2] };
    h.undo(current);
    current.n.push(3);
    expect(h.redo({ n: [1] })).toEqual({ n: [2] });
  });

  it('forgets the oldest edit beyond the limit, and keeps exactly `limit` of them', () => {
    const h = make(3);
    for (let k = 0; k < 5; k++) h.record({ n: [k] });
    let now: S = { n: [5] };
    const seen: number[] = [];
    while (h.canUndo) { now = h.undo(now)!; seen.push(now.n[0]); }
    expect(seen).toEqual([4, 3, 2]);
  });

  it('a limit of 1 keeps the latest edit only', () => {
    const h = make(1);
    h.record({ n: [1] });
    h.record({ n: [2] });
    expect(h.undo({ n: [3] })).toEqual({ n: [2] });
    expect(h.canUndo).toBe(false);
  });

  it('rejects a limit below 1', () => {
    expect(() => make(0)).toThrow(/at least 1/);
  });

  it('clear forgets everything', () => {
    const h = make();
    h.record({ n: [1] });
    h.undo({ n: [2] });
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
