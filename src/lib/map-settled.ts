/**
 * Sidebar -> map: "resolve once what is in the layer store is actually drawn".
 *
 * The map component registers the implementation (it alone knows which
 * renderer is active and holds the map instance); panels just await
 * `waitForMapSettled()`. Before the map has registered, or after it unmounts,
 * the wait resolves immediately so a caller can never hang on it.
 */
type MapSettledWaiter = () => Promise<void>;

let waiter: MapSettledWaiter | null = null;

export function registerMapSettledWaiter(fn: MapSettledWaiter | null): void {
  waiter = fn;
}

export function waitForMapSettled(): Promise<void> {
  return waiter ? waiter() : Promise.resolve();
}
