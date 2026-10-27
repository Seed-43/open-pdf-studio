// Module Web Worker voor de wijzigingsdetectie van de vergelijkingsmodus
// (#465). Draait detectChanges() buiten de hoofdthread; het berichtformaat
// staat in change-detect-protocol.js. Aangemaakt vanuit compare-viewport.js.

import { attachDetectWorker } from './change-detect-protocol.js';

attachDetectWorker(self);
