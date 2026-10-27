/**
 * Veelhoek-tool (#622): hoek voor hoek tekenen, zoals de polylijn, maar
 * gesloten.
 *
 * - Klik = hoekpunt (objectsnap, rastersnap, poolhoek-volgen, Shift = vaste
 *   hoekstap, getypte lengte + Enter = volgend hoekpunt op die afstand).
 * - Tijdens het tekenen: de zijden tot nu toe, de rubberen zijde naar de
 *   cursor en, gestippeld, de sluitende zijde terug naar het eerste hoekpunt.
 * - Afronden: dubbelklik, Enter, rechtermuisklik of een klik op het eerste
 *   hoekpunt (vanaf drie hoekpunten). Backspace haalt het laatste hoekpunt
 *   weg, Esc breekt af zonder iets achter te laten.
 * - Een SLEEP vóór het eerste hoekpunt tekent zoals vroeger de regelmatige
 *   zeshoek in het gesleepte vak — nu met hoekpunten die daarna net zo
 *   verschuifbaar zijn.
 *
 * Het model krijgt de geplaatste punten (`points`), het vak eromheen en
 * `sides` = het aantal hoekpunten (annotation-creators.js,
 * buildPolygonFromPoints).
 */

import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { isKlikSleep } from '../../annotations/minimummaat.js';
import { ruimTekenPuntenOp, VEELHOEK_MIN_PUNTEN } from '../../annotations/veelhoek-punten.js';
import { buildPolygonFromPoints, veelhoekOpmaak } from '../annotation-creators.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import { setPolarAnchor, clearPolarAnchor } from '../snap-engine.js';
import i18next from '../../i18n/config.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  setTypeLengthStart,
  applyToEndpoint,
  typeLengthHasBuffer,
} from '../type-length-input.js';

// Schermafstand (px) waarbinnen een klik het eerste hoekpunt raakt en dus
// sluit, zoals bij het meetvlak en de vrije wolk.
const SLUIT_PX = 10;
// Twee punten binnen deze schermafstand zijn één punt (de twee klikken van
// een dubbelklik).
const DUBBEL_PX = 3;

// De veelhoek in aanbouw.
const _v = {
  punten: [],
  pagina: null,
  // Knop ingedrukt vóór het eerste hoekpunt: klik (hoekpunt) of sleep
  // (regelmatige zeshoek) — dat beslist het loslaten.
  druk: null,
  // Laatste voorvertoningspunt (snap, Shift en getypte lengte verwerkt);
  // Enter met een getypte lengte plaatst het volgende hoekpunt in die richting.
  vorig: { x: 0, y: 0 },
  // Richting vastgezet bij het eerste getypte teken (zoals het meetvlak).
  richting: { x: null, y: null },
  schaal: 1,
};

/** De hoekpunten van de veelhoek in aanbouw (kopie; voor tests en de brug). */
export function veelhoekInAanbouw() {
  return _v.punten.map((p) => ({ x: p.x, y: p.y }));
}

const bezig = () => _v.punten.length > 0 || !!_v.druk;

function _hint() {
  updateStatusMessage(i18next.t('drawing.polygonHint', {
    ns: 'ribbon',
    defaultValue: 'Click each corner — double-click, Enter or click the first corner to finish; Backspace removes the last corner, Esc cancels. Drag for a regular hexagon.',
  }), 8000);
}

// Poolhoek-volgen (F10) per zijde vanaf het laatst GEPLAATSTE hoekpunt, net
// als het meetvlak (#536); zonder hoekpunten geen anker.
function _zetPoolAnker(ctx) {
  const laatste = _v.punten[_v.punten.length - 1];
  if (laatste) (ctx?.setPolarAnchor || setPolarAnchor)(laatste.x, laatste.y, ctx?.pageNum ?? _v.pagina);
  else (ctx?.clearPolarAnchor || clearPolarAnchor)();
}

function _reset() {
  _v.punten = [];
  _v.pagina = null;
  _v.druk = null;
  _v.richting.x = null;
  _v.richting.y = null;
  state.isDrawing = false;
  exitTypeLengthMode();
  state._typeLengthCommit = null;
}

/**
 * Het volgende hoekpunt bij de cursor: objectsnap (ook op de eigen punten),
 * Shift = vaste hoekstap, een getypte lengte langs de vastgezette richting,
 * en vanaf drie hoekpunten het eerste hoekpunt als sluitpunt.
 */
function _volgendPunt(ctx, e, { voorvertoning = false } = {}) {
  const { x, y } = ctx;
  const prefs = state.preferences || {};
  const laatste = _v.punten[_v.punten.length - 1];
  const snap = ctx.snap(x, y, null, _v.punten);
  let px = snap.snapped ? snap.x : x;
  let py = snap.snapped ? snap.y : y;

  if (_v.punten.length >= VEELHOEK_MIN_PUNTEN) {
    const eerste = _v.punten[0];
    if (Math.hypot(px - eerste.x, py - eerste.y) < SLUIT_PX / (ctx.scale || 1)) {
      return { x: eerste.x, y: eerste.y, sluit: true, snap: null };
    }
  }

  if (!snap.snapped && e?.shiftKey && prefs.enableAngleSnap && laatste && ctx.snapAngle) {
    const len = Math.hypot(x - laatste.x, y - laatste.y);
    const hoek = ctx.snapAngle(Math.atan2(y - laatste.y, x - laatste.x) * 180 / Math.PI, prefs.angleSnapDegrees) * Math.PI / 180;
    px = laatste.x + len * Math.cos(hoek);
    py = laatste.y + len * Math.sin(hoek);
  }

  let gesnapt = snap.snapped ? snap : null;
  if (laatste && typeLengthHasBuffer()) {
    if (voorvertoning && _v.richting.x == null) {
      _v.richting.x = _v.vorig.x;
      _v.richting.y = _v.vorig.y;
    }
    const rx = _v.richting.x ?? px;
    const ry = _v.richting.y ?? py;
    const ep = applyToEndpoint(laatste.x, laatste.y, rx, ry);
    px = ep.x; py = ep.y;
    gesnapt = null;
  } else if (!typeLengthHasBuffer()) {
    _v.richting.x = null;
    _v.richting.y = null;
  }
  return { x: px, y: py, sluit: false, snap: gesnapt };
}

function _voegToe(ctx, p) {
  if (_v.punten.length === 0) {
    _v.pagina = getActiveDocument()?.currentPage || ctx.pageNum || 1;
  }
  _v.punten.push({ x: p.x, y: p.y });
  _v.richting.x = null;
  _v.richting.y = null;
  _v.vorig = { x: p.x, y: p.y };
  _zetPoolAnker(ctx);
  if (_v.punten.length === 1) {
    enterTypeLengthMode(p.x, p.y);
    state._typeLengthCommit = () => _commitLengte(ctx);
  } else {
    setTypeLengthStart(p.x, p.y);
  }
  ctx.redraw();
  _tekenVoorbeeld(ctx, null, false);
}

// Enter met een getypte lengte: het volgende hoekpunt op die afstand, in de
// richting van de voorvertoning.
function _commitLengte(ctx) {
  const laatste = _v.punten[_v.punten.length - 1];
  if (!laatste) return;
  const rx = _v.richting.x ?? _v.vorig.x;
  const ry = _v.richting.y ?? _v.vorig.y;
  const ep = applyToEndpoint(laatste.x, laatste.y, rx, ry);
  _voegToe(ctx, ep);
}

/** Afronden: de veelhoek aanmaken (vanaf drie hoekpunten), anders niets. */
function _rondAf(ctx) {
  const punten = ruimTekenPuntenOp(_v.punten, DUBBEL_PX / (_v.schaal || 1));
  const pagina = _v.pagina;
  _reset();
  _zetPoolAnker(ctx);
  let ann = null;
  if (punten.length >= VEELHOEK_MIN_PUNTEN) {
    ann = createAnnotation(buildPolygonFromPoints(punten, pagina || getActiveDocument()?.currentPage || 1));
    const doc = getActiveDocument();
    if (doc) doc.annotations.push(ann);
    (ctx.recordAdd || recordAdd)(ann);
  }
  ctx.redraw();
  if (ann) import('../manager.js').then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect());
  return ann;
}

function _afbreken(ctx) {
  _reset();
  _zetPoolAnker(ctx);
  ctx.redraw();
}

function _laatsteWeg(ctx) {
  if (_v.punten.length === 0) return false;
  _v.punten.pop();
  _v.richting.x = null;
  _v.richting.y = null;
  const laatste = _v.punten[_v.punten.length - 1];
  if (laatste) {
    setTypeLengthStart(laatste.x, laatste.y);
  } else {
    exitTypeLengthMode();
    state._typeLengthCommit = null;
  }
  _zetPoolAnker(ctx);
  ctx.redraw();
  if (laatste && ctx.canvasCtx) _tekenVoorbeeld(ctx, _v.vorig, false);
  return true;
}

/**
 * De veelhoek in aanbouw op het canvas: de geplaatste zijden en de rubberen
 * zijde naar de cursor doorgetrokken, de sluitende zijde gestippeld, de
 * vulling (als de stijl die heeft) licht.
 */
function _tekenVoorbeeld(ctx, cursor, sluit) {
  const c = ctx.canvasCtx;
  if (!c || _v.punten.length === 0) return;
  const opm = veelhoekOpmaak();
  const kleur = opm.strokeColor && opm.strokeColor !== 'none' ? opm.strokeColor : opm.color;
  const schaal = ctx.scale || 1;
  const pts = cursor && !sluit ? [..._v.punten, cursor] : _v.punten.slice();

  c.save();
  applyToolTransform(c);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.globalAlpha = opm.opacity ?? 1;

  if (pts.length >= 3 && opm.fillColor) {
    c.beginPath();
    pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    c.closePath();
    c.fillStyle = opm.fillColor;
    c.globalAlpha = (opm.opacity ?? 1) * 0.35;
    c.fill();
    c.globalAlpha = opm.opacity ?? 1;
  }

  c.strokeStyle = kleur;
  c.lineWidth = opm.lineWidth || 1;
  c.beginPath();
  pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
  c.stroke();

  // Sluitende zijde: van het laatste punt (de cursor) terug naar het eerste.
  if (pts.length >= 3) {
    const eerste = pts[0];
    const laatste = pts[pts.length - 1];
    c.setLineDash([6 / schaal, 4 / schaal]);
    c.beginPath();
    c.moveTo(laatste.x, laatste.y);
    c.lineTo(eerste.x, eerste.y);
    c.stroke();
    c.setLineDash([]);
  }

  // Op het eerste hoekpunt: een ring die zegt "hier sluit je".
  if (sluit) {
    const eerste = _v.punten[0];
    c.globalAlpha = 1;
    c.strokeStyle = '#1D90E0';
    c.lineWidth = 2 / schaal;
    c.beginPath();
    c.arc(eerste.x, eerste.y, SLUIT_PX / schaal, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
}

function _hoverSnap(ctx) {
  const snap = ctx.snap(ctx.x, ctx.y);
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}

export const polygonTool = {
  name: 'polygon',
  cursor: 'crosshair',

  onActivate() {
    _reset();
    _hint();
  },

  onPointerDown(ctx, e) {
    _v.schaal = ctx.scale || _v.schaal;
    // Rechtermuisklik rondt af (zoals de polylijn); het contextmenu dat
    // erop volgt, wordt ingeslikt.
    if (e.button === 2) {
      if (_v.punten.length > 0) {
        _rondAf(ctx);
        state._suppressNextContextmenu = true;
      }
      return;
    }
    if (e.button !== 0) return;
    // Dubbelklik (de dispatcher geeft hem door met detail 2).
    if (e.detail === 2) {
      if (_v.punten.length > 0) _rondAf(ctx);
      return;
    }
    if (_v.punten.length === 0) {
      // Eerste hoekpunt of een sleep: het loslaten beslist. Het startpunt
      // heeft de dispatcher al gesnapt (object- of rastersnap).
      _v.druk = { x: state.startX, y: state.startY, sleep: false };
      state.isDrawing = true;
      return;
    }
    _zetPoolAnker(ctx);
    const p = _volgendPunt(ctx, e);
    if (p.sluit) {
      _rondAf(ctx);
      return;
    }
    _voegToe(ctx, p);
  },

  onPointerMove(ctx, e) {
    _v.schaal = ctx.scale || _v.schaal;
    const { x, y } = ctx;
    if (_v.druk) {
      if (!_v.druk.sleep && !isKlikSleep(x - _v.druk.x, y - _v.druk.y, ctx.scale)) _v.druk.sleep = true;
      if (_v.druk.sleep) {
        const snap = ctx.snap(x, y);
        state.lastSnapResult = snap.snapped ? snap : null;
        ctx.drawShapePreview(snap.snapped ? snap.x : x, snap.snapped ? snap.y : y, e);
      }
      return;
    }
    if (_v.punten.length === 0) {
      _hoverSnap(ctx);
      return;
    }
    _zetPoolAnker(ctx);
    const p = _volgendPunt(ctx, e, { voorvertoning: true });
    state.lastSnapResult = p.snap;
    if (!p.sluit) _v.vorig = { x: p.x, y: p.y };
    ctx.redraw();
    _tekenVoorbeeld(ctx, { x: p.x, y: p.y }, p.sluit);
    if (p.snap) ctx.drawSnapIndicator(p.snap);
  },

  onPointerUp(ctx, e) {
    const druk = _v.druk;
    if (!druk) return true;
    _v.druk = null;
    state.isDrawing = false;
    const snap = ctx.snap(ctx.x, ctx.y);
    const eindX = snap.snapped ? snap.x : ctx.snapToGrid(ctx.x);
    const eindY = snap.snapped ? snap.y : ctx.snapToGrid(ctx.y);
    state.lastSnapResult = null;
    if (druk.sleep && !isKlikSleep(eindX - druk.x, eindY - druk.y, ctx.scale)) {
      // Sleep: de regelmatige zeshoek in het vak (zoals vroeger).
      const ann = ctx.createAnnotationFromTool('polygon', druk.x, druk.y, eindX, eindY, e);
      if (ann) {
        const doc = getActiveDocument();
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
      }
      ctx.redraw();
      import('../manager.js').then((m) => m.maybeRevertToSelect && m.maybeRevertToSelect());
      return true;
    }
    // Klik: het eerste hoekpunt.
    _voegToe(ctx, { x: druk.x, y: druk.y });
    return true;
  },

  onKeyDown(ctx, e) {
    if (!bezig()) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (_v.punten.length >= VEELHOEK_MIN_PUNTEN) _rondAf(ctx);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      _laatsteWeg(ctx);
    }
  },

  // Esc breekt af: geen halve veelhoek achterlaten. De toetsenbord-handler
  // schakelt daarna naar de selectietool.
  onEscape(ctx) {
    if (!bezig()) return false;
    _afbreken(ctx);
    return true;
  },

  onDeactivate(ctx) {
    const wasBezig = bezig();
    _reset();
    _zetPoolAnker(ctx);
    if (wasBezig) ctx.redraw();
  },
};
