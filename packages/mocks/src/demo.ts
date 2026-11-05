import { createStore } from "./db";

/** Switches for presenting the demo (Demo controls panel in the apps). Mock mode only. */
export interface DemoControls {
  /** The next receipt post fails with a network error before anything is saved. */
  failNextReceiptPost: boolean;
}

export const demoControls = createStore<DemoControls>("controls", () => ({ failNextReceiptPost: false }));
