// Na opslaan met tekstbewerkingen herlaadt het document uit een nieuw
// werkbestand (saver.js → reloadFromBytes). De tekstlaag van de enkele
// pagina bleef dan staan: hij toonde de tekst van vóór het opslaan (na
// ongedaan/opnieuw zelfs de originele), zodat zoeken, selecteren en opnieuw
// bewerken op tekst werkten die niet meer in het bestand stond. De laag
// onthoudt nu uit welk bestand hij komt en de renderer bouwt hem opnieuw als
// dat bestand veranderd is.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const laag = fs.readFileSync(new URL('./text-layer.js', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../pdf/renderer.js', import.meta.url), 'utf8');

test('de tekstlaag van de enkele pagina onthoudt zijn bronbestand', () => {
  const f = laag.slice(laag.indexOf('export async function createSinglePageTextLayer'),
    laag.indexOf('export function clearSinglePageTextLayer'));
  assert.match(f, /laag\.dataset\.bron = doc\?\.filePath \|\| ''/);
});

test('de renderer bouwt een laag uit een ander bestand opnieuw', () => {
  const i = renderer.indexOf('const _textLayerStale');
  assert.ok(i > 0);
  assert.match(renderer.slice(i, i + 400), /_existingTextLayer\.dataset\.bron \?\? ''\) !== \(doc\.filePath \|\| ''\)/);
});
