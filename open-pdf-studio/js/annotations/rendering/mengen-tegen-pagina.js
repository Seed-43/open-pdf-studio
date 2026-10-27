// Een annotatie met een mengmodus (#614) mengen met de PAGINA, niet met niets.
//
// Annotaties staan op een doorzichtige overlay boven het paginacanvas
// (#annotation-canvas, en .annotation-canvas per pagina in de doorlopende
// weergave). globalCompositeOperation mengt alleen met wat op hetzelfde canvas
// staat, en daar staat onder de annotatie niets: elke mengmodus zag er dus uit
// als 'normaal'. (In de miniaturen staan pagina en annotaties wél op één
// canvas; daar werkte het al.)
//
// Werkwijze, per gemengde annotatie en alleen binnen haar omhullende:
//   1. achter   = pagina + tussenlagen + wat de overlay al heeft (ondoorzichtig);
//   2. gemengd  = de annotatie met haar mengmodus over `achter` getekend;
//   3. vorm     = de annotatie gewoon (source-over) op leeg, voor haar dekking α;
//   4. bijdrage = (gemengd − (1−α)·achter) / α met dekking α.
// Die bijdrage met gewoon 'source-over' op de overlay levert boven de pagina
// precies `gemengd` op (zie mengBijdrage). Waar de annotatie niets tekent
// (α = 0) blijft de overlay ongemoeid; de pagina zelf wordt dus nooit op de
// overlay gekopieerd en een latere paginarender kan niet "achterlopen" buiten
// de annotatie.

/** Grens op het aantal pixels per gemengde annotatie (ruim een 4K-scherm). */
const MAX_PIXELS = 3840 * 2400;

/**
 * De bijdrage van een gemengde annotatie aan een doorzichtige overlay.
 * Alle arrays zijn RGBA, 8 bit, niet-voorvermenigvuldigd (zoals ImageData).
 * `uit` mag dezelfde array zijn als `vorm`.
 *
 * @param {Uint8ClampedArray} achter  wat het scherm zonder de annotatie toont (α 255)
 * @param {Uint8ClampedArray} gemengd hetzelfde met de annotatie erover gemengd (α 255)
 * @param {Uint8ClampedArray} vorm    de annotatie gewoon getekend op leeg (alleen α telt)
 * @param {Uint8ClampedArray} uit
 */
export function mengBijdrage(achter, gemengd, vorm, uit) {
  for (let i = 0; i < vorm.length; i += 4) {
    const a = vorm[i + 3];
    if (a === 0) {
      uit[i] = 0; uit[i + 1] = 0; uit[i + 2] = 0; uit[i + 3] = 0;
      continue;
    }
    const rest = 1 - a / 255;
    const k = 255 / a;
    for (let c = 0; c < 3; c++) {
      // Voorvermenigvuldigde bijdrage (schaal 0..255): F − (1−α)·achter ∈ [0, a].
      let p = gemengd[i + c] - rest * achter[i + c];
      if (p < 0) p = 0;
      else if (p > a) p = a;
      uit[i + c] = p * k;
    }
    uit[i + 3] = a;
  }
}

const _klad = [null, null];
function kladCtx(nr, w, h) {
  let c = _klad[nr];
  if (!c) {
    const canvas = document.createElement('canvas');
    c = canvas.getContext('2d', { willReadFrequently: true });
    if (!c) return null;
    _klad[nr] = c;
  }
  if (c.canvas.width !== w || c.canvas.height !== h) {
    c.canvas.width = w;
    c.canvas.height = h;
  } else {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  return c;
}

/** De omhullende (device-pixels van het canvas) van een rechthoek onder matrix m. */
function deviceOmhullende(m, r, marge) {
  const hoeken = [
    [r.x - marge, r.y - marge], [r.x + r.width + marge, r.y - marge],
    [r.x - marge, r.y + r.height + marge], [r.x + r.width + marge, r.y + r.height + marge],
  ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const xs = hoeken.map((h) => h[0]);
  const ys = hoeken.map((h) => h[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Teken een annotatie met mengmodus op een overlay, gemengd met de pagina
 * eronder. Geeft false terug als dat hier niet kan (geen paginacanvas, niet in
 * beeld gemeten, te groot of een canvas dat niet uitgelezen mag worden); de
 * aanroeper tekent dan zelf gewoon.
 *
 * @param {CanvasRenderingContext2D} ctx overlay, met de transform van de annotatie
 * @param {HTMLCanvasElement|null} paginaCanvas het canvas met de pagina onder ctx.canvas
 * @param {(c: CanvasRenderingContext2D, normaal: boolean) => void} teken tekent
 *   de annotatie op c in de huidige transform; `normaal` = zonder mengmodus
 * @param {{x:number,y:number,width:number,height:number}|null} omhullende in
 *   de gebruikersruimte van ctx (de paginaruimte), of null voor het hele canvas
 * @param {object} [opties]
 * @param {number} [opties.marge] extra rand (gebruikersruimte) rond de omhullende
 * @param {Array<{canvas: HTMLCanvasElement, op: string}>} [opties.tussenlagen]
 *   lagen tussen pagina en overlay met dezelfde maat en plek als de overlay
 *   (de tekstmarkeerlaag, CSS-multiply)
 */
export function tekenGemengdTegenPagina(ctx, paginaCanvas, teken, omhullende, { marge = 0, tussenlagen = [] } = {}) {
  const doel = ctx?.canvas;
  if (!doel || !paginaCanvas || typeof doel.getBoundingClientRect !== 'function') return false;
  const W = doel.width;
  const H = doel.height;
  if (!(W > 0 && H > 0 && paginaCanvas.width > 0 && paginaCanvas.height > 0)) return false;
  const or = doel.getBoundingClientRect();
  const pr = paginaCanvas.getBoundingClientRect();
  if (!(or.width > 0 && or.height > 0 && pr.width > 0 && pr.height > 0)) return false;

  const m = ctx.getTransform();
  let bx0 = 0, by0 = 0, bx1 = W, by1 = H;
  if (omhullende && [omhullende.x, omhullende.y, omhullende.width, omhullende.height].every(Number.isFinite)) {
    const d = deviceOmhullende(m, omhullende, marge);
    // Twee pixels extra voor de anti-aliasing aan de rand.
    bx0 = Math.max(0, Math.floor(d.x0) - 2);
    by0 = Math.max(0, Math.floor(d.y0) - 2);
    bx1 = Math.min(W, Math.ceil(d.x1) + 2);
    by1 = Math.min(H, Math.ceil(d.y1) + 2);
  }
  const bw = bx1 - bx0;
  const bh = by1 - by0;
  const heelCanvas = bx0 === 0 && by0 === 0 && bx1 === W && by1 === H;

  if (bw > 0 && bh > 0) {
    if (bw * bh > MAX_PIXELS) return false;
    try {
      // 1. Achter: pagina (via schermpositie, de resoluties verschillen),
      //    tussenlagen en wat de overlay al heeft.
      const t = kladCtx(0, bw, bh);
      const s = kladCtx(1, bw, bh);
      if (!t || !s) return false;
      t.fillStyle = '#ffffff';
      t.fillRect(0, 0, bw, bh);
      const kx = or.width / W;
      const ky = or.height / H;
      const px = paginaCanvas.width / pr.width;
      const py = paginaCanvas.height / pr.height;
      t.drawImage(paginaCanvas,
        (or.left + bx0 * kx - pr.left) * px, (or.top + by0 * ky - pr.top) * py,
        bw * kx * px, bh * ky * py, 0, 0, bw, bh);
      for (const laag of tussenlagen) {
        if (!laag?.canvas || laag.canvas.width !== W || laag.canvas.height !== H) continue;
        t.globalCompositeOperation = laag.op || 'source-over';
        t.drawImage(laag.canvas, bx0, by0, bw, bh, 0, 0, bw, bh);
      }
      t.globalCompositeOperation = 'source-over';
      t.drawImage(doel, bx0, by0, bw, bh, 0, 0, bw, bh);
      const achter = t.getImageData(0, 0, bw, bh).data;

      // 2. Gemengd: de annotatie met haar mengmodus over `achter`.
      t.setTransform(m.a, m.b, m.c, m.d, m.e - bx0, m.f - by0);
      teken(t, false);
      const gemengd = t.getImageData(0, 0, bw, bh).data;

      // 3. Vorm: de dekking van de annotatie.
      s.setTransform(m.a, m.b, m.c, m.d, m.e - bx0, m.f - by0);
      teken(s, true);
      const vorm = s.getImageData(0, 0, bw, bh);

      // 4. De bijdrage, met gewoon source-over op de overlay.
      mengBijdrage(achter, gemengd, vorm.data, vorm.data);
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.putImageData(vorm, 0, 0);
      ctx.save();
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(s.canvas, 0, 0, bw, bh, bx0, by0, bw, bh);
      } finally {
        ctx.restore();
      }
    } catch (_) {
      // Bv. een canvas dat niet uitgelezen mag worden: gewoon tekenen.
      return false;
    }
  }

  // Wat buiten de (geschatte) omhullende valt — een label, een pijlpunt —
  // gewoon tekenen in plaats van het weg te laten.
  if (!heelCanvas) {
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      if (bw > 0 && bh > 0) ctx.rect(bx0, by0, bw, bh);
      ctx.clip('evenodd');
      ctx.setTransform(m);
      teken(ctx, false);
    } finally {
      ctx.restore();
    }
  }
  return true;
}
