// ── Tekstblokken voor het bewerken van PDF-tekst ──
//
// Groepeert de spans van een tekstlaag tot regels en de regels tot blokken,
// zoals de Tekst bewerken-tool ze opent. Zonder DOM, zodat het onder node te
// toetsen is; text-edit-tool.js levert de items en koppelt de spans terug.
//
// Alles gebeurt in het kader van de tekst zelf: u langs de leesrichting en
// v loodrecht erop (omhoog). Eerder stonden pdfX en pdfY er rechtstreeks in.
// Dat klopt alleen voor horizontale tekst: bij tekst die op een /Rotate-blad
// rechtop staat (hoek 90) liggen de labels van een titelblok onder elkaar met
// dezelfde pdfY, en werden ze één regel ("KENMERK:FORMAAT:SCHAAL:"). Een schuin
// straatnaamlabel kwam zo in dezelfde regel als horizontale perceelteksten,
// die bij het opslaan in de richting en het font van het label terugkwamen.
// Spans met een andere tekstrichting komen daarom nooit in dezelfde regel of
// hetzelfde blok.

import { buildLineSegments } from './text-edit-appearance.js';

// Twee richtingen zijn gelijk binnen deze marge (graden).
const HOEK_MARGE = 1;

function hoekVerschil(a, b) {
  const d = Math.abs((((Number(a) || 0) - (Number(b) || 0)) % 360 + 540) % 360 - 180);
  return d;
}

// u (langs de leesrichting) en v (loodrecht, omhoog) van een punt.
export function tekstKader(x, y, hoekGraden) {
  const rad = (Number(hoekGraden) || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { u: x * cos + y * sin, v: -x * sin + y * cos };
}

/**
 * @param {Array<{pdfX:number, pdfY:number, pdfWidth:number, fontSize:number,
 *   angle?:number, text?:string, fontKey?:string}>} items
 * @param {'strict'|'loose'} mode
 * @returns {number[][][]} blokken; elk blok is een lijst regels, elke regel
 *   een lijst item-indexen in leesvolgorde
 */
export function groepeerTekstBlokken(items, mode = 'strict') {
  if (!Array.isArray(items) || items.length === 0) return [];

  // ── Stap 0: per tekstrichting ──
  const volgorde = items.map((_, i) => i)
    .sort((a, b) => (((Number(items[a].angle) || 0) % 360 + 360) % 360)
      - (((Number(items[b].angle) || 0) % 360 + 360) % 360));
  const richtingen = [];
  for (const i of volgorde) {
    const hoek = Number(items[i].angle) || 0;
    const groep = richtingen.find(g => hoekVerschil(g.hoek, hoek) <= HOEK_MARGE);
    if (groep) groep.leden.push(i);
    else richtingen.push({ hoek, leden: [i] });
  }

  const blokken = [];
  for (const { hoek, leden } of richtingen) {
    const el = leden.map(i => {
      const it = items[i];
      const { u, v } = tekstKader(Number(it.pdfX) || 0, Number(it.pdfY) || 0, hoek);
      return { i, u, v, w: Number(it.pdfWidth) || 0, fs: Number(it.fontSize) || 10, it };
    });

    // ── Stap 1: regels op v (bovenste regel eerst) ──
    el.sort((a, b) => b.v - a.v || a.u - b.u);
    const regels = [];
    let cur = [el[0]];
    for (let k = 1; k < el.length; k++) {
      if (Math.abs(el[k].v - cur[0].v) <= cur[0].fs * 0.3) cur.push(el[k]);
      else { regels.push(cur); cur = [el[k]]; }
    }
    regels.push(cur);
    for (const r of regels) r.sort((a, b) => a.u - b.u);

    // ── Stap 1b: splitsen bij grote sprongen langs de regel (kolommen) ──
    const stukken = [];
    for (const r of regels) {
      let seg = [r[0]];
      for (let k = 1; k < r.length; k++) {
        const vorige = seg[seg.length - 1];
        const gat = r[k].u - (vorige.u + vorige.w);
        if (gat > ((vorige.fs + r[k].fs) / 2) * 3) { stukken.push(seg); seg = [r[k]]; }
        else seg.push(r[k]);
      }
      stukken.push(seg);
    }

    // ── Stap 1c (alleen strict): fragmenten van één rij weer samenvoegen ──
    let eenheden = stukken;
    if (mode === 'strict') {
      eenheden = [];
      for (const frag of stukken) {
        const vorige = eenheden[eenheden.length - 1];
        if (vorige) {
          const zelfdeRij = Math.abs(frag[0].v - vorige[0].v) <= vorige[0].fs * 0.3;
          const laatste = vorige[vorige.length - 1];
          const gat = frag[0].u - (laatste.u + laatste.w);
          if (zelfdeRij && gat <= ((laatste.fs + frag[0].fs) / 2) * 6) { vorige.push(...frag); continue; }
        }
        eenheden.push([...frag]);
      }
    }

    const meta = eenheden.map(r => {
      const seg = buildLineSegments(r.map(e => ({
        text: e.it.text ?? '', pdfX: e.it.pdfX, pdfY: e.it.pdfY, pdfWidth: e.w, fontSize: e.fs,
      })), hoek);
      const dom = r.reduce((beste, e) => {
        const len = String(e.it.text ?? '').trim().length;
        return len > beste.len ? { e, len } : beste;
      }, { e: r[0], len: String(r[0].it.text ?? '').trim().length }).e;
      return {
        kolomachtig: Array.isArray(seg.segments) && seg.segments.length >= 2,
        fontKey: dom.it.fontKey ?? '',
      };
    });

    // ── Stap 2: opeenvolgende regels tot blokken ──
    let blok = [eenheden[0]];
    let blokMeta = [0];
    let vorigeAfstand = null;
    for (let k = 1; k < eenheden.length; k++) {
      const vorige = blok[blok.length - 1];
      const volgende = eenheden[k];
      const fsA = vorige[0].fs;
      const fsB = volgende[0].fs;
      const fontRatio = Math.min(fsA, fsB) / Math.max(fsA, fsB);
      const afstand = vorige[0].v - volgende[0].v;
      const gemFs = (fsA + fsB) / 2;
      const linksA = Math.min(...vorige.map(e => e.u));
      const linksB = Math.min(...volgende.map(e => e.u));
      let zelfde = fontRatio > 0.92
        && afstand > gemFs * 0.5
        && afstand < gemFs * 1.8
        && Math.abs(linksB - linksA) < gemFs * 1.0;
      if (zelfde && mode === 'strict') {
        const mA = meta[blokMeta[blokMeta.length - 1]];
        const mB = meta[k];
        if (mA.kolomachtig && mB.kolomachtig) zelfde = false;
        else if (mA.fontKey !== mB.fontKey) zelfde = false;
        else if (vorigeAfstand != null
            && Math.abs(afstand - vorigeAfstand) > Math.max(1, vorigeAfstand * 0.25)) zelfde = false;
      }
      if (zelfde) {
        blok.push(volgende);
        blokMeta.push(k);
        vorigeAfstand = afstand;
      } else {
        blokken.push(blok);
        blok = [volgende];
        blokMeta = [k];
        vorigeAfstand = null;
      }
    }
    blokken.push(blok);
  }
  return blokken.map(b => b.map(r => r.map(e => e.i)));
}

/**
 * Regelafstand van een blok: de gemiddelde afstand tussen de baselines,
 * loodrecht op de leesrichting. Voor horizontale tekst het verschil in pdfY.
 * @param {Array<{pdfX:number, pdfY:number}>} regelAnkers eerste item per regel
 */
export function blokRegelafstand(regelAnkers, hoekGraden, fontSize) {
  if (!Array.isArray(regelAnkers) || regelAnkers.length < 2) return (Number(fontSize) || 10) * 1.2;
  let som = 0;
  for (let k = 1; k < regelAnkers.length; k++) {
    const a = tekstKader(regelAnkers[k - 1].pdfX, regelAnkers[k - 1].pdfY, hoekGraden);
    const b = tekstKader(regelAnkers[k].pdfX, regelAnkers[k].pdfY, hoekGraden);
    som += a.v - b.v;
  }
  return som / (regelAnkers.length - 1);
}
