import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// rendering.js draait niet onder kale node (canvas, DOM); dit bewaakt de bron.
const bron = readFileSync(new URL('./rendering.js', import.meta.url), 'utf8');

test('een stempelbeeld dat nog decodeert hertekent de actieve weergave, ook doorlopend', () => {
  // Na het laden uit een PDF is het beeld vaak nog niet klaar; zonder
  // hertekenen blijft de stempel onzichtbaar. redrawAnnotations() tekent in de
  // doorlopende weergave niet de pagina's, dus de load-handler moet de
  // weergave-bewuste helper gebruiken.
  const stempel = bron.slice(bron.indexOf("case 'stamp': {"), bron.indexOf('if (stampImg && stampImg.complete)'));
  assert.match(stempel, /addEventListener\('load', \(\) => \{ try \{ hertekenActieveWeergave\(\); \} catch \(_\) \{\} \}, \{ once: true \}\)/);
  assert.match(bron, /function hertekenActieveWeergave\(\) \{\s+const doc = state\.documents\[state\.activeDocumentIndex\];\s+if \(doc\?\.viewMode === 'continuous'\) redrawContinuous\(\);\s+else redrawAnnotations\(\);\s+\}/);
});
