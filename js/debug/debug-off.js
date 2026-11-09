// LCARSv2 Debug menu OFF entrypoint (slice S18, worker R). Loaded for the
// "Debug menu: no" setting in every window, so it tears down on import: the menu
// and the picker go, and the shared host is removed. Notes stay.
import { teardown } from './menu.js';

teardown();
export { teardown as off };
