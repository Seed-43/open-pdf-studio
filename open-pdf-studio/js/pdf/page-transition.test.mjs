// Plaatshouder bij een paginawissel: de miniatuur van de doelpagina wordt
// direct over het PDF-canvas getoond. De miniatuurstore bewaart per pagina
// een object { dataURL, width, height, px }; het <img> moet de dataURL
// krijgen, niet het object zelf ('[object Object]' laadt niets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

function nepElement(tag, extra = {}) {
  return {
    tagName: tag, id: '', style: {}, parentElement: null, ...extra,
    removeAttribute(naam) { delete this[naam]; },
  };
}

// De ouder van het canvas onthoudt het laatst toegevoegde kind: de plaatshouder.
const ouder = nepElement('div', {
  kind: null,
  appendChild(kind) { kind.parentElement = this; this.kind = kind; },
});
const canvas = nepElement('canvas', { offsetWidth: 600, offsetHeight: 800, offsetLeft: 0, offsetTop: 0 });
canvas.parentElement = ouder;
globalThis.document.getElementById = (id) => (id === 'pdf-canvas' ? canvas : null);
globalThis.document.createElement = (tag) => nepElement(tag);

const { setThumbnailImage, clearAllThumbnails } = await import('../solid/stores/panels/thumbnailStore.js');
const { showPagePlaceholder, clearPagePlaceholder } = await import('./page-transition.js');

const plaatshouder = () => ouder.kind;

test('the placeholder shows the data URL of a cached thumbnail object', () => {
  clearAllThumbnails();
  clearPagePlaceholder();
  const url = 'data:image/png;base64,AAAA';
  setThumbnailImage(2, { dataURL: url, width: 150, height: 212, px: 300 });
  showPagePlaceholder(2);
  const img = plaatshouder();
  assert.ok(img, 'an overlay image is placed over the canvas');
  assert.equal(img.src, url);
  assert.equal(img.style.display, 'block');
});

test('the placeholder also accepts a thumbnail stored as a plain data URL string', () => {
  clearAllThumbnails();
  clearPagePlaceholder();
  const url = 'data:image/png;base64,BBBB';
  setThumbnailImage(3, url);
  showPagePlaceholder(3);
  assert.equal(plaatshouder().src, url);
  assert.equal(plaatshouder().style.display, 'block');
});

test('without a usable thumbnail no placeholder is shown', () => {
  clearAllThumbnails();
  clearPagePlaceholder();
  setThumbnailImage(4, { width: 150, height: 212 });
  showPagePlaceholder(4);
  assert.notEqual(plaatshouder()?.style.display, 'block');
});
