/**
 * Vak kiezen voor de paginalabels (naambouwer, #580): de gebruiker sleept een
 * vak om een stuk tekst op de pagina, bijvoorbeeld het tekeningnummer. Maakt
 * nooit een annotatie; het vak (app-ruimte) en de pagina gaan terug naar de
 * dialoog. Escape of de rechtermuisknop breekt af, net als een ander
 * gereedschap kiezen. Een balk boven de pagina zegt wat er van de gebruiker
 * verwacht wordt.
 */
import { setTool } from '../manager.js';
import { state } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';

export const LABEL_GEBIED_TOOL = 'pageLabelPick';

let _flow = null;     // { klaar(resultaat | null), vorige }
let _start = null;    // { x, y, pageNum }
let _laatste = null;  // laatste punt op de startpagina
let _balk = null;

function toonBalk(tekst) {
  verbergBalk();
  const balk = document.createElement('div');
  balk.className = 'page-label-pick-bar';
  balk.textContent = tekst;
  const vak = document.getElementById('pdf-container')?.getBoundingClientRect();
  if (vak && vak.width > 0) {
    balk.style.left = `${vak.left + vak.width / 2}px`;
    balk.style.top = `${vak.top + 6}px`;
  }
  document.body.appendChild(balk);
  _balk = balk;
}

function verbergBalk() {
  _balk?.remove();
  _balk = null;
}

function rond(resultaat, { herstelTool = true } = {}) {
  const flow = _flow;
  _flow = null;
  _start = null;
  _laatste = null;
  verbergBalk();
  if (!flow) return;
  if (herstelTool) setTool(flow.vorige && flow.vorige !== LABEL_GEBIED_TOOL ? flow.vorige : 'select');
  flow.klaar(resultaat);
}

/**
 * Laat de gebruiker een vak slepen. Geeft { page, rect: {x, y, width, height} }
 * in app-ruimte, of null bij afbreken.
 */
export function kiesLabelGebied(hint) {
  if (_flow) rond(null, { herstelTool: false });
  return new Promise((resolve) => {
    _flow = { klaar: resolve, vorige: state.currentTool };
    toonBalk(hint);
    setTool(LABEL_GEBIED_TOOL);
    // Een alleen-lezen PDF/A laat geen ander gereedschap toe.
    if (state.currentTool !== LABEL_GEBIED_TOOL) rond(null, { herstelTool: false });
  });
}

function vakTussen(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export const labelGebiedTool = {
  name: LABEL_GEBIED_TOOL,
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      e.preventDefault?.();
      rond(null);
      ctx.redraw();
      return;
    }
    if (e.button !== 0 || !_flow) return;
    _start = { x: ctx.x, y: ctx.y, pageNum: ctx.pageNum };
    _laatste = { x: ctx.x, y: ctx.y };
  },

  onPointerMove(ctx) {
    // In de doorlopende weergave telt buiten de startpagina het laatste punt
    // op die pagina; het vak hoort bij één pagina.
    if (!_start || ctx.pageNum !== _start.pageNum) return;
    _laatste = { x: ctx.x, y: ctx.y };
    ctx.redraw();
    const c = ctx.canvasCtx;
    if (!c) return;
    const v = vakTussen(_start, _laatste);
    c.save();
    applyToolTransform(c);
    c.strokeStyle = '#0078d7';
    c.fillStyle = 'rgba(0, 120, 215, 0.10)';
    c.lineWidth = 1.5 / ctx.scale;
    c.setLineDash([6 / ctx.scale, 3 / ctx.scale]);
    c.fillRect(v.x, v.y, v.width, v.height);
    c.strokeRect(v.x, v.y, v.width, v.height);
    c.restore();
  },

  onPointerUp(ctx) {
    if (!_start) return false;
    if (ctx.pageNum === _start.pageNum) _laatste = { x: ctx.x, y: ctx.y };
    const vak = vakTussen(_start, _laatste);
    const pageNum = _start.pageNum;
    _start = null;
    ctx.redraw();
    // Een klik zonder sleep is geen vak: opnieuw proberen.
    const min = 4 / (ctx.scale || 1);
    if (vak.width < min || vak.height < min) return true;
    rond({ page: pageNum, rect: vak });
    return true;
  },

  onKeyDown(ctx, e) {
    if (e.key !== 'Escape') return;
    e.preventDefault?.();
    rond(null);
    ctx.redraw();
  },

  onDeactivate(ctx) {
    // Ander gereedschap gekozen terwijl er nog gekozen werd: afbreken.
    if (_flow) rond(null, { herstelTool: false });
    ctx?.redraw?.();
  },
};
