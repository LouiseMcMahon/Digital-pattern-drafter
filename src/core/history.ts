/**
 * Undo and redo over whole-state snapshots. Call `record(state)` with the state as it is *before* a change; `undo`
 * and `redo` take the current state and hand back the one to go to (or undefined when there is nothing to go to).
 * Snapshots are copied on the way in and out, so later edits never reach into the history.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly clone: (state: T) => T, private readonly limit = 100) {
    if (limit < 1) throw new Error('History limit must be at least 1');
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  record(before: T) {
    this.past.push(this.clone(before));
    if (this.past.length > this.limit) this.past.shift();
    this.future = []; // a new edit ends the redo branch
  }

  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(this.clone(current));
    return this.clone(previous);
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.clone(current));
    return this.clone(next);
  }

  clear() { this.past = []; this.future = []; }
}
