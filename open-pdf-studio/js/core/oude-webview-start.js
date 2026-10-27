// Als allereerste module van de app geïmporteerd (js/main.js): de polyfills
// staan klaar vóór PDF.js of een andere module ze nodig heeft (#596).
import { installeerPolyfills } from './oude-webview.js';

const aangevuld = installeerPolyfills(globalThis);
if (aangevuld.length > 0) {
  console.info('[oude-webview] aangevuld:', aangevuld.join(', '));
}
