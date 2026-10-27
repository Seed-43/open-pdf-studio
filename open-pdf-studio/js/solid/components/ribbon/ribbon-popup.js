// Popups in de ribbon (galerij, menu's, split-knoppen, thema's) — #617.
//
// De ribbongroepen staan in .ribbon-groups-adaptive met overflow: hidden (dat
// verbergt de groepen die naar de "Meer"-flyout zijn verhuisd, zie
// AdaptiveGroups.jsx). Een popup met position: absolute daarbinnen wordt aan
// de onderrand van de ribbon afgeknipt en verdwijnt achter de documenttabs.
// Met position: fixed ontsnapt hij aan die klip, maar dan moet zijn plek uit
// de knop berekend worden — en opnieuw bij scrollen en een andere
// venstermaat. Zelfde aanpak als de kleurkiezer en de overflow-flyout.
//
// Gebruik in een component:
//   volgPopup(() => popupRef, () => knopRef, open, { rechts: true });

import { createEffect, onMount, onCleanup } from 'solid-js';

/**
 * Plek (viewport-pixels) voor een popup van `breedte` × `hoogte` bij een knop:
 * eronder, links (of met `rechts` rechts) uitgelijnd, binnen het venster; past
 * hij er onder niet, dan erboven.
 */
export function berekenPopupPlek({ knop, breedte, hoogte, venster, rechts = false, marge = 4 }) {
  let left = rechts ? knop.right - breedte : knop.left;
  left = Math.max(marge, Math.min(Math.round(left), venster.breedte - breedte - marge));
  let top = Math.round(knop.bottom);
  if (top + hoogte > venster.hoogte - marge) top = Math.max(marge, Math.round(knop.top) - hoogte);
  return { left, top };
}

/** Zet een (zichtbare) popup met position: fixed onder zijn knop. */
export function plaatsPopup(popup, knop, { rechts = false, marge = 4 } = {}) {
  if (!popup || !knop) return;
  const b = knop.getBoundingClientRect();
  // Meten zonder dat de oude plek meetelt (een popup tegen de rand krimpt).
  popup.style.left = '0px';
  popup.style.top = '-9999px';
  const plek = berekenPopupPlek({
    knop: b, breedte: popup.offsetWidth, hoogte: popup.offsetHeight,
    venster: { breedte: window.innerWidth, hoogte: window.innerHeight }, rechts, marge,
  });
  popup.style.left = `${plek.left}px`;
  popup.style.top = `${plek.top}px`;
}

/**
 * Plaats een popup zodra hij opengaat en houd hem bij zijn knop zolang hij
 * open is (scrollen, venstermaat). Binnen een Solid-component aanroepen.
 *
 * @param {() => HTMLElement|undefined} popupVan
 * @param {() => HTMLElement|undefined} knopVan
 * @param {() => boolean} isOpen
 * @param {{ rechts?: boolean, marge?: number }} [opties]
 */
export function volgPopup(popupVan, knopVan, isOpen, opties) {
  const plaats = () => { if (isOpen()) plaatsPopup(popupVan(), knopVan(), opties); };
  // De popup is display: none tot hij open is; zijn maat bestaat pas een
  // frame nadat de klasse er staat.
  createEffect(() => { if (isOpen()) requestAnimationFrame(plaats); });
  onMount(() => {
    window.addEventListener('resize', plaats);
    window.addEventListener('scroll', plaats, true);
    onCleanup(() => {
      window.removeEventListener('resize', plaats);
      window.removeEventListener('scroll', plaats, true);
    });
  });
}
