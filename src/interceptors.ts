import type { InterceptorEntry, IInterceptorPipeline } from './types.js';

export class InterceptorManager<F, R> implements IInterceptorPipeline<F, R> {
  private _handlers: Array<InterceptorEntry<F, R> | null> = [];

  get handlers(): ReadonlyArray<InterceptorEntry<F, R> | null> {
    return this._handlers;
  }

  use(fulfilled: F, rejected?: R): number {
    this._handlers.push({ fulfilled, rejected });
    return this._handlers.length - 1;
  }

  eject(id: number): void {
    if (id >= 0 && id < this._handlers.length) {
      this._handlers[id] = null;
    }
  }
}
