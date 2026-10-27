// Draaiing van een veelhoek of wolk (#619): zie vorm-draaiing.js.

import assert from 'node:assert/strict';
import test from 'node:test';
import { draaiPunt, draaiMidden, ontdraaiVorm, draaiCm } from './vorm-draaiing.js';

const dicht = (a, b, wat) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-9, `${wat}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

test('draaiPunt draait met de klok mee in app-coördinaten (y omlaag), zoals ctx.rotate', () => {
  dicht(draaiPunt({ x: 1, y: 0 }, { x: 0, y: 0 }, 90), { x: 0, y: 1 }, 'rechts wordt onder');
  dicht(draaiPunt({ x: 12, y: 5 }, { x: 10, y: 5 }, 180), { x: 8, y: 5 }, 'om een eigen midden');
});

test('draaiMidden is het midden van het vak, zonder vak dat van de punten', () => {
  dicht(draaiMidden({ x: 10, y: 20, width: 100, height: 40 }, []), { x: 60, y: 40 }, 'vak');
  dicht(draaiMidden({}, [{ x: 0, y: 0 }, { x: 10, y: 4 }]), { x: 5, y: 2 }, 'punten');
});

test('ontdraaiVorm geeft een vorm die om het midden van zijn omhullende gedraaid weer de invoer is', () => {
  // Een vijfhoek in een vak raakt de onderkant niet: het midden van het vak
  // is niet dat van de punten. De teruggedraaide vorm moet dat oplossen.
  const c = { x: 160, y: 240 };
  const vijfhoek = [...Array(5)].map((_, i) => {
    const h = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    return { x: c.x + 60 * Math.cos(h), y: c.y + 40 * Math.sin(h) };
  });
  const gedraaid = vijfhoek.map((p) => draaiPunt(p, c, 30));
  const terug = ontdraaiVorm(gedraaid, 30);
  const midden = draaiMidden({}, terug);
  terug.forEach((p, i) => dicht(draaiPunt(p, midden, 30), gedraaid[i], `hoek ${i}`));
});

test('ontdraaiVorm geeft de hoeken van het vak terug bij een gedraaide rechthoek', () => {
  const hoeken = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }];
  const c = { x: 20, y: 10 };
  const terug = ontdraaiVorm(hoeken.map((p) => draaiPunt(p, c, -73)), -73);
  terug.forEach((p, i) => dicht(p, hoeken[i], `hoek ${i}`));
});

test('zonder hoek blijven de punten zoals ze zijn', () => {
  const punten = [{ x: 1, y: 2 }];
  assert.equal(ontdraaiVorm(punten, 0), punten);
});

test('draaiCm draait in PDF-ruimte (y omhoog) dezelfde kant op als het scherm', () => {
  // 90° met de klok mee om (10, 10): (20, 10) rechts gaat naar (10, 0) onder.
  const cm = draaiCm(10, 10, 90);
  const [a, b, c, d, e, f] = cm.replace(' cm\n', '').split(' ').map(Number);
  const x = 20, y = 10;
  assert.deepEqual([a * x + c * y + e, b * x + d * y + f], [10, 0]);
  assert.match(cm, /^0 -1 1 0 0 20 cm\n$/);
});
