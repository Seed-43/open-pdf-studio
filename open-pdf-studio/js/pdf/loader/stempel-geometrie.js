// Draaiing en vak van een stempel of afbeelding, gelezen uit de appearance.
//
// Een stempel of afbeelding heeft in de PDF-specificatie geen draaiing: de
// appearance bepaalt hoe hij op de pagina staat. De app tekent een stempel als
// bitmap rechtop in zijn vak en draait dat vak om het midden (`rotation`, met
// de klok mee op het scherm). stempelGeometrie leidt vak en draaiing af uit
// wat elke PDF-lezer tekent: de /Rect, de /BBox en /Matrix van de appearance
// en de cm-operatoren in de inhoud, samen met de /Rotate van de pagina.
// kiesStempelWeergave bepaalt wat de app toont: zoals de appearance de bitmap
// tekent (wat elke andere lezer toont), behalve twee oude gevallen van deze
// app zelf: een draaiing die alleen in /OPS_Rotation staat, en oude
// schermafdrukken op een gedraaide pagina (zie hieronder). De saver schrijft
// /OPS_Rotation niet meer voor stempels en afbeeldingen; hij bakt de getoonde
// draaiing in de appearance, zodat elke lezer daarna toont wat de app toont.
//
// Oude schermafdrukken die op een gedraaide pagina geplakt zijn (bijv.
// /Rotate 90, met /OPS_Rotation -90): de appearance tekent de bitmap zonder
// draaiing in de ongedraaide /Rect, maar de pixels liggen zoals op het scherm:
// hun verhouding past bij de /Rect zoals je hem op de gedraaide pagina ziet.
// De bedoeling was rechtop, vullend in het vak op het scherm; zie
// isSchermBeeldOpGedraaidBlad.
//
// Puur: geen pdf-lib, geen DOM. Matrices zoals in PDF: [a b c d e f], een punt
// als rijvector, p' = p · M.

const IDENTITEIT = [1, 0, 0, 1, 0, 0];

/** a × b: eerst a, dan b. */
export function vermenigvuldig(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function pasToe(m, x, y) {
  return { x: x * m[0] + y * m[2] + m[4], y: x * m[1] + y * m[3] + m[5] };
}

const isGetal = (v) => typeof v === 'number' && Number.isFinite(v);
const isMatrix = (m) => Array.isArray(m) && m.length === 6 && m.every(isGetal);

/** Hoek in graden naar (-180, 180]. */
export function normaliseerHoek(graden) {
  let h = graden % 360;
  if (h <= -180) h += 360;
  if (h > 180) h -= 360;
  return h;
}

// Ruis van afronding (een /Matrix met 0,0117 graden, cosinus 6e-17) mag geen
// draaiing worden: binnen een halve graad van een rechte hoek is het die
// rechte hoek; anders op een honderdste graad.
function rondHoek(graden) {
  const h = normaliseerHoek(graden);
  const recht = Math.round(h / 90) * 90;
  if (Math.abs(h - recht) < 0.5) return normaliseerHoek(recht) || 0;
  return Math.round(h * 100) / 100 || 0;
}

const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
const isWit = (c) => c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0';

/**
 * Leest uit een content stream wat voor de plaatsing telt:
 * - beeldDo: per `Do` de naam en de CTM op dat moment (hoogstens 32);
 * - eersteRe: de eerste `re` met zijn CTM en x, y, w, h;
 * - eersteVerfCtm: de CTM bij de eerste tekenopdracht (m, re, BT, Do, sh, BI).
 * Strings, arrays en inline-afbeeldingen worden overgeslagen. Een onleesbare
 * stream geeft lege velden, nooit een fout.
 * @param {string} inhoud
 */
export function analyseerInhoud(inhoud) {
  const uit = { beeldDo: [], eersteRe: null, eersteVerfCtm: null };
  if (typeof inhoud !== 'string' || !inhoud) return uit;
  let ctm = IDENTITEIT;
  const stapel = [];
  let operanden = [];
  const n = inhoud.length;
  let i = 0;
  let stappen = 0;
  const verf = () => { if (!uit.eersteVerfCtm) uit.eersteVerfCtm = ctm; };
  while (i < n && stappen++ < 200000) {
    const c = inhoud[i];
    if (isWit(c)) { i++; continue; }
    if (c === '%') { while (i < n && inhoud[i] !== '\n' && inhoud[i] !== '\r') i++; continue; }
    if (c === '(') {
      let diepte = 1; i++;
      while (i < n && diepte > 0) {
        const t = inhoud[i];
        if (t === '\\') { i += 2; continue; }
        if (t === '(') diepte++;
        else if (t === ')') diepte--;
        i++;
      }
      operanden.push(null);
      continue;
    }
    if (c === '<') {
      if (inhoud[i + 1] === '<') { i += 2; continue; }
      const eind = inhoud.indexOf('>', i + 1);
      i = eind < 0 ? n : eind + 1;
      operanden.push(null);
      continue;
    }
    if (c === '>') { i += inhoud[i + 1] === '>' ? 2 : 1; continue; }
    if (c === '[' || c === ']' || c === '{' || c === '}' || c === ')') { i++; continue; }
    if (c === '/') {
      let j = i + 1;
      while (j < n && !isWit(inhoud[j]) && !DELIM.has(inhoud[j])) j++;
      operanden.push({ naam: inhoud.slice(i + 1, j) });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !isWit(inhoud[j]) && !DELIM.has(inhoud[j])) j++;
    if (j === i) { i++; continue; }
    const woord = inhoud.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(woord)) { operanden.push(parseFloat(woord)); continue; }
    switch (woord) {
      case 'q': stapel.push(ctm); break;
      case 'Q': if (stapel.length) ctm = stapel.pop(); break;
      case 'cm': {
        const m = operanden.slice(-6);
        if (m.length === 6 && m.every(isGetal)) ctm = vermenigvuldig(m, ctm);
        break;
      }
      case 're': {
        verf();
        const r = operanden.slice(-4);
        if (!uit.eersteRe && r.length === 4 && r.every(isGetal)) {
          uit.eersteRe = { ctm, x: r[0], y: r[1], w: r[2], h: r[3] };
        }
        break;
      }
      case 'Do': {
        verf();
        const naam = operanden[operanden.length - 1];
        if (naam && typeof naam === 'object' && uit.beeldDo.length < 32) uit.beeldDo.push({ naam: naam.naam, ctm });
        break;
      }
      case 'm': case 'BT': case 'sh': verf(); break;
      case 'BI': {
        verf();
        // Inline-afbeelding: de gegevens na ID tot EI overslaan.
        const id = inhoud.indexOf('ID', i);
        const ei = id < 0 ? -1 : inhoud.slice(id + 2).search(/\sEI(\s|$)/);
        i = ei < 0 ? n : id + 2 + ei + 3;
        break;
      }
      default: break;
    }
    operanden = [];
  }
  return uit;
}

/**
 * De afbeelding van de /BBox op de /Rect (algoritme 8.1 van de specificatie):
 * de /BBox door /Matrix, de omhullende daarvan geschaald en verschoven op de
 * /Rect. Geeft de matrix van appearance-ruimte naar paginaruimte, of null.
 */
export function appearanceNaarPagina(rect, bbox, matrix) {
  if (!Array.isArray(rect) || rect.length < 4 || !rect.every(isGetal)) return null;
  if (!Array.isArray(bbox) || bbox.length < 4 || !bbox.every(isGetal)) return null;
  const m = isMatrix(matrix) ? matrix : IDENTITEIT;
  const hoeken = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]
    .map(([x, y]) => pasToe(m, x, y));
  const xs = hoeken.map((p) => p.x);
  const ys = hoeken.map((p) => p.y);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const rx0 = Math.min(rect[0], rect[2]), rx1 = Math.max(rect[0], rect[2]);
  const ry0 = Math.min(rect[1], rect[3]), ry1 = Math.max(rect[1], rect[3]);
  if (!(bx1 - bx0 > 1e-6) || !(by1 - by0 > 1e-6) || !(rx1 - rx0 > 1e-6) || !(ry1 - ry0 > 1e-6)) return null;
  const sx = (rx1 - rx0) / (bx1 - bx0);
  const sy = (ry1 - ry0) / (by1 - by0);
  return vermenigvuldig(m, [sx, 0, 0, sy, rx0 - sx * bx0, ry0 - sy * by0]);
}

/**
 * Dekt het eenheidsvierkant onder `m` (zijn omhullende) minstens 90 % van de
 * /BBox? Een bijgesneden beeld steekt buiten de /BBox uit en telt als vullend.
 */
export function vultBBox(m, bbox) {
  const hoeken = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => pasToe(m, x, y));
  const xs = hoeken.map((p) => p.x);
  const ys = hoeken.map((p) => p.y);
  const bx0 = Math.min(bbox[0], bbox[2]), bx1 = Math.max(bbox[0], bbox[2]);
  const by0 = Math.min(bbox[1], bbox[3]), by1 = Math.max(bbox[1], bbox[3]);
  const opp = (bx1 - bx0) * (by1 - by0);
  if (!(opp > 0)) return false;
  const iw = Math.min(bx1, Math.max(...xs)) - Math.max(bx0, Math.min(...xs));
  const ih = Math.min(by1, Math.max(...ys)) - Math.max(by0, Math.min(...ys));
  return iw > 0 && ih > 0 && (iw * ih) / opp >= 0.9;
}

/**
 * Oude schermafdruk op een gedraaide pagina? Alleen als
 * - de pagina een kwartslag gedraaid is (/Rotate 90 of 270),
 * - de appearance de bitmap niet draait (hoek 0 in PDF-ruimte),
 * - de pixelverhouding duidelijk bij het vak past zoals het op het scherm
 *   staat (afmetingen omgewisseld) en duidelijk niet bij het vak zoals de
 *   appearance het vult.
 * Vrijwel vierkante beelden kunnen dat onderscheid niet maken en blijven
 * zoals de appearance ze tekent. Maten in logaritmen van verhoudingen: 0,08
 * is 8 % afwijking, 0,25 is 28 %.
 * @param {{ paginaRotatie:number, beeldHoek:number, pixelW:number, pixelH:number,
 *           vakW:number, vakH:number }} p  vak = de lengtes van de beeldassen
 */
export function isSchermBeeldOpGedraaidBlad({ paginaRotatie, beeldHoek, pixelW, pixelH, vakW, vakH }) {
  const rot = ((Math.round(paginaRotatie || 0) % 360) + 360) % 360;
  if (rot !== 90 && rot !== 270) return false;
  if (Math.abs(normaliseerHoek(beeldHoek || 0)) > 0.5) return false;
  if (![pixelW, pixelH, vakW, vakH].every((v) => isGetal(v) && v > 0)) return false;
  const pixels = Math.log(pixelW / pixelH);
  const naarVak = Math.abs(pixels - Math.log(vakW / vakH));
  const naarScherm = Math.abs(pixels - Math.log(vakH / vakW));
  return naarScherm <= 0.08 && naarVak >= 0.25;
}

/**
 * Vak en draaiing van een stempel of afbeelding zoals zijn appearance hem
 * tekent. Wat de app daarvan toont, kiest kiesStempelWeergave.
 *
 * @param {object} p
 * @param {number[]} p.rect           /Rect in PDF-ruimte
 * @param {number} p.paginaRotatie    /Rotate van de pagina
 * @param {{ matrix?:number[], bbox:number[], beeld?:{ctm:number[],pixelW?:number,pixelH?:number}|null,
 *           eersteRe?:{ctm:number[],x:number,y:number,w:number,h:number}|null }} p.ap
 * @param {'beeld'|'tekst'} p.soort   beeld: de eerste afbeelding in de appearance;
 *                                    tekst: het vak van de eerste `re` (tekststempel van de app)
 * @param {{left?:number,top?:number,right?:number,bottom?:number}} [p.crop]  bijsnijden (#212)
 * @returns {null|{ rotation:number, beeldHoek:number, midden:{x:number,y:number}, breedte:number,
 *                  hoogte:number, schermBeeld:boolean, eigenAp:boolean }}
 *   rotation: draaiing op het scherm zoals elke lezer hem tekent; beeldHoek:
 *   hoek van het beeld in PDF-ruimte; midden in PDF-ruimte; breedte/hoogte in
 *   PDF-eenheden langs de assen van het (ongedraaide) vak; schermBeeld: oude
 *   schermafdruk (zie isSchermBeeldOpGedraaidBlad); eigenAp: de appearance
 *   komt van deze saver (clip op precies het vak van het beeld).
 *   null als de appearance geen eenduidig vak geeft (spiegeling, scheefstand,
 *   geen afbeelding): de aanroeper valt dan terug op /Rect.
 */
export function stempelGeometrie({ rect, paginaRotatie = 0, ap, soort = 'beeld', crop = null }) {
  if (!ap) return null;
  const naarPagina = appearanceNaarPagina(rect, ap.bbox, ap.matrix);
  if (!naarPagina) return null;

  const reVak = (re) => (re && isMatrix(re.ctm) && [re.x, re.y, re.w, re.h].every(isGetal) && re.w > 0 && re.h > 0
    ? vermenigvuldig([re.w, 0, 0, re.h, re.x, re.y], re.ctm) : null);

  // Het eenheidsvierkant van het vak in appearance-ruimte.
  let vak;
  if (soort === 'beeld') {
    if (!ap.beeld || !isMatrix(ap.beeld.ctm)) return null;
    vak = ap.beeld.ctm;
  } else {
    vak = reVak(ap.eersteRe);
    if (!vak) return null;
  }
  // Het vak moet de appearance vullen: de omhullende van het beeld (of van
  // de rechthoek) dekt de /BBox. Een samengestelde appearance waarin de
  // afbeelding maar een onderdeel is (een strook in een tekening), geeft
  // geen vak; dan blijft de /Rect.
  if (!vultBBox(vak, ap.bbox)) return null;
  const t = vermenigvuldig(vak, naarPagina);
  const lx = Math.hypot(t[0], t[1]);
  const ly = Math.hypot(t[2], t[3]);
  if (!(lx > 1e-6) || !(ly > 1e-6)) return null;
  const det = t[0] * t[3] - t[1] * t[2];
  if (det <= 0) return null; // gespiegeld: geen draaiing van een rechtop vak
  // Scheef (bijv. een niet-uniforme /BBox-schaal over een schuine inhoud).
  if (Math.abs(t[0] * t[2] + t[1] * t[3]) / (lx * ly) > 0.02) return null;

  // Hoek van de x-as in PDF-ruimte (tegen de klok in). De pagina draait het
  // geheel nog met de klok mee: op het scherm staat het vak op rot - hoek.
  const beeldHoek = Math.atan2(t[1], t[0]) * 180 / Math.PI;
  const rot = ((Math.round(paginaRotatie || 0) % 360) + 360) % 360;

  const cl = Math.max(0, Math.min(0.95, crop?.left || 0));
  const cr = Math.max(0, Math.min(0.95, crop?.right || 0));
  const ct = Math.max(0, Math.min(0.95, crop?.top || 0));
  const cb = Math.max(0, Math.min(0.95, crop?.bottom || 0));
  const bijgesneden = soort === 'beeld' && cl + cr < 1 && ct + cb < 1;
  const fw = bijgesneden ? 1 - cl - cr : 1;
  const fh = bijgesneden ? 1 - ct - cb : 1;
  // Midden van het zichtbare venster; beeldruimte: v = 1 is de bovenste rij.
  const u = bijgesneden ? cl + fw / 2 : 0.5;
  const v = bijgesneden ? cb + fh / 2 : 0.5;
  const midden = pasToe(t, u, v);
  const breedte = lx * fw;
  const hoogte = ly * fh;

  // Eigen appearance: de saver zet een clip op precies het (zichtbare) vak
  // vóór het beeld. Een tekststempel wordt alleen zo teruggelezen.
  let eigenAp = soort === 'tekst';
  if (soort === 'beeld') {
    const clip = reVak(ap.eersteRe);
    if (clip) {
      const tc = vermenigvuldig(clip, naarPagina);
      const cm = pasToe(tc, 0.5, 0.5);
      const tol = (a) => 0.01 + Math.abs(a) * 1e-4;
      eigenAp = Math.abs(normaliseerHoek(Math.atan2(tc[1], tc[0]) * 180 / Math.PI - beeldHoek)) < 0.05 &&
        Math.abs(Math.hypot(tc[0], tc[1]) - breedte) <= tol(breedte) &&
        Math.abs(Math.hypot(tc[2], tc[3]) - hoogte) <= tol(hoogte) &&
        Math.hypot(cm.x - midden.x, cm.y - midden.y) <= 0.05;
    }
  }

  const schermBeeld = soort === 'beeld' && isSchermBeeldOpGedraaidBlad({
    paginaRotatie: rot, beeldHoek,
    pixelW: ap.beeld.pixelW, pixelH: ap.beeld.pixelH, vakW: lx, vakH: ly,
  });

  return { rotation: rondHoek(rot - beeldHoek), beeldHoek, midden, breedte, hoogte, schermBeeld, eigenAp };
}

/**
 * Draaiing zoals de app een stempel uit een ouder of ander bestand altijd
 * toonde: een oude /OPS_Rotation, anders de hoek van /Matrix verrekend met
 * de pagina-/Rotate (zichtbaar is het verschil van die twee), anders 0.
 * @param {{ opsRotation?:number, matrixHoek?:number, paginaRotatie?:number }} p
 */
export function oudeStempelDraaiing({ opsRotation, matrixHoek, paginaRotatie = 0 }) {
  if (isGetal(opsRotation) && opsRotation !== 0) return Math.round(opsRotation);
  if (isGetal(matrixHoek) && Math.abs(matrixHoek) > 1) {
    const rot = ((Math.round(paginaRotatie || 0) % 360) + 360) % 360;
    let r = -(Math.round(matrixHoek) - rot);
    while (r > 180) r -= 360;
    while (r < -180) r += 360;
    return Math.abs(r) <= 1 ? 0 : r;
  }
  return 0;
}

/**
 * Valt het vak uit de appearance samen met de /Rect zoals die op het scherm
 * staat, in dezelfde draaiing? Dan tekenen beide weergaven hetzelfde (op
 * afrondingsruis na: een halve punt of 0,5 %).
 */
function zelfdeAlsRect(geometrie, rotatie, rect, paginaRotatie) {
  if (!Array.isArray(rect) || rect.length < 4 || !rect.every(isGetal)) return false;
  if (Math.abs(normaliseerHoek(geometrie.rotation - rotatie)) > 0.5) return false;
  const rot = ((Math.round(paginaRotatie || 0) % 360) + 360) % 360;
  const rw = Math.abs(rect[2] - rect[0]);
  const rh = Math.abs(rect[3] - rect[1]);
  const [sw, sh] = rot === 90 || rot === 270 ? [rh, rw] : [rw, rh];
  const tol = (a) => Math.max(0.5, Math.abs(a) * 0.005);
  const mx = (rect[0] + rect[2]) / 2;
  const my = (rect[1] + rect[3]) / 2;
  return Math.abs(geometrie.breedte - sw) <= tol(sw) && Math.abs(geometrie.hoogte - sh) <= tol(sh) &&
    Math.hypot(geometrie.midden.x - mx, geometrie.midden.y - my) <= tol(Math.min(sw, sh));
}

/**
 * Wat de app van een stempel of afbeelding toont.
 *
 * - Een appearance van deze saver (eigenAp, zonder /OPS_Rotation): precies
 *   zoals hij getekend is.
 * - Een oude schermafdruk op een gedraaide pagina (schermBeeld, zoals CP-21):
 *   rechtop, vullend in het vak zoals het op het scherm staat (/Rect); een
 *   oude /OPS_Rotation telt daar niet.
 * - Een oude /OPS_Rotation (een oudere versie van deze app; de appearance
 *   draaide de bitmap toen niet zelf): de /Rect zoals op het scherm, in die
 *   draaiing (-CP-21-3/-4).
 * - Elke andere appearance die de plaats van de bitmap eenduidig vastlegt
 *   (stempelGeometrie geeft een vak): precies zoals hij getekend is, zoals
 *   elke andere lezer hem toont. Een bitmap die de appearance in een
 *   liggend vak tekent, wordt dus niet in een staande /Rect geperst (VO
 *   Constructie op een /Rotate-90-blad). Valt dat vak samen met de /Rect op
 *   het scherm, dan blijft het de /Rect (zelfde beeld, geen afrondingsruis).
 * Opslaan bakt de getoonde draaiing in de appearance (saver/stempel-draaiing.js)
 * en schrijft /OPS_Rotation niet meer; daarna geldt het eerste geval en
 * tonen andere lezers hetzelfde.
 *
 * @param {object} p
 * @param {ReturnType<typeof stempelGeometrie>} p.geometrie
 * @param {number} p.paginaRotatie
 * @param {number|undefined} p.opsRotation  /OPS_Rotation uit het bestand, of undefined
 * @param {number|undefined} p.matrixHoek   hoek van /Matrix van de appearance, of undefined
 * @param {number[]} [p.rect]               /Rect in PDF-ruimte (voor de vergelijking hierboven)
 * @returns {null|{ rotation:number, vak:'ap'|'rect' }}  vak: 'ap' = het vak uit de
 *   geometrie, 'rect' = de /Rect zoals hij op het scherm staat
 */
export function kiesStempelWeergave({ geometrie, paginaRotatie = 0, opsRotation, matrixHoek, rect }) {
  if (!geometrie) return null;
  const zoalsGetekend = { rotation: geometrie.rotation, vak: 'ap' };
  if (geometrie.eigenAp && !isGetal(opsRotation)) return zoalsGetekend;
  if (geometrie.schermBeeld) return { rotation: 0, vak: 'rect' };
  const oud = { rotation: oudeStempelDraaiing({ opsRotation, matrixHoek, paginaRotatie }), vak: 'rect' };
  if (isGetal(opsRotation) && opsRotation !== 0) return oud;
  if (zelfdeAlsRect(geometrie, oud.rotation, rect, paginaRotatie)) return oud;
  return zoalsGetekend;
}
