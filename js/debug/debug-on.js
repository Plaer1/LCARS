// LCARSv2 Debug menu ON entrypoint (slice S18, worker R). Millennium loads this
// module for the "Debug menu: yes" setting and does not call install(), so it
// installs on import. install() is idempotent, so a hot reload is harmless.
import { install } from './menu.js';

install();
export { install };
