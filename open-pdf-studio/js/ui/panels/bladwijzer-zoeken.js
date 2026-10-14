// Bladwijzerpaneel (#578): welke bladwijzer hoort bij de pagina in beeld, en
// het zoekveld dat naar een bladwijzer springt. Pure functies zonder DOM of
// documentstatus, zodat ze los te testen zijn. Ze werken op de componentboom
// uit bookmarks.js: knopen met { id, title, page, children }; ook kinderen van
// ingeklapte ouders staan erin.

// Alle bladwijzers in boomvolgorde (ouder vóór zijn kinderen), met diepte.
export function inBoomvolgorde(knopen, diepte = 0, uit = []) {
  for (const knoop of knopen || []) {
    if (!knoop) continue;
    uit.push({ id: knoop.id, title: knoop.title || '', page: knoop.page, diepte });
    inBoomvolgorde(knoop.children, diepte + 1, uit);
  }
  return uit;
}

// De bladwijzer van de pagina in beeld: de bladwijzer die precies naar deze
// pagina wijst. Wijzen er meer naar dezelfde pagina (een groep en het eerste
// blad eronder), dan wint de diepste - dat is het blad zelf; bij gelijke
// diepte de eerste in de boom. Geen bladwijzer voor deze pagina: null.
export function huidigeBladwijzer(knopen, pagina) {
  if (!Number.isInteger(pagina)) return null;
  let beste = null;
  for (const b of inBoomvolgorde(knopen)) {
    if (b.page !== pagina) continue;
    if (!beste || b.diepte > beste.diepte) beste = b;
  }
  return beste ? beste.id : null;
}

// Alle treffers voor de zoektekst, in de volgorde waarin Enter ze afloopt:
// eerst de titels die met de tekst BEGINNEN, daarna de titels die hem alleen
// bevatten, elk in boomvolgorde. Hoofdletters tellen niet; witruimte rond de
// tekst ook niet. De lijst wordt niet gefilterd - dit is alleen de sprongorde.
export function bladwijzerTreffers(knopen, tekst) {
  const naald = String(tekst ?? '').trim().toLocaleLowerCase();
  if (!naald) return [];
  const begint = [];
  const bevat = [];
  for (const b of inBoomvolgorde(knopen)) {
    const titel = b.title.toLocaleLowerCase();
    if (titel.startsWith(naald)) begint.push(b.id);
    else if (titel.includes(naald)) bevat.push(b.id);
  }
  return [...begint, ...bevat];
}

// De treffer na `naId` (rondgaand); zonder `naId`, of als die geen treffer
// (meer) is, de eerste treffer. Geen treffers: null.
export function volgendeTreffer(knopen, tekst, naId = null) {
  const treffers = bladwijzerTreffers(knopen, tekst);
  if (!treffers.length) return null;
  const i = naId == null ? -1 : treffers.indexOf(naId);
  return treffers[(i + 1) % treffers.length];
}

// Ids van de ingeklapte voorouders van een bladwijzer, uit de platte lijst
// van het document ({ id, parentId, expanded }). Die moeten open om de
// bladwijzer te tonen. Bestand tegen een kringverwijzing in parentId.
export function ingeklapteVoorouders(bladwijzers, id) {
  const perId = new Map((bladwijzers || []).map(b => [b.id, b]));
  const uit = [];
  const gezien = new Set();
  let huidig = perId.get(id);
  while (huidig && huidig.parentId && !gezien.has(huidig.parentId)) {
    gezien.add(huidig.parentId);
    const ouder = perId.get(huidig.parentId);
    if (ouder && !ouder.expanded) uit.push(ouder.id);
    huidig = ouder;
  }
  return uit;
}

// Scrollpositie die `item` in `lijst` zichtbaar maakt, zonder de omringende
// panelen mee te schuiven (scrollIntoView doet dat wel). 'nearest' schuift
// alleen als het item (deels) buiten beeld staat; 'center' zet het midden.
// Rechthoeken in schermcoördinaten ({ top, bottom }); geeft null als er niets
// hoeft te veranderen.
export function scrollVoorItem(lijstRect, itemRect, scrollTop, modus = 'nearest') {
  if (!lijstRect || !itemRect) return null;
  const hoogte = lijstRect.bottom - lijstRect.top;
  const boven = itemRect.top - lijstRect.top;
  const onder = itemRect.bottom - lijstRect.top;
  if (modus === 'center') {
    const doel = scrollTop + boven - (hoogte - (onder - boven)) / 2;
    return Math.max(0, Math.round(doel));
  }
  if (boven < 0) return Math.max(0, Math.round(scrollTop + boven));
  if (onder > hoogte) return Math.max(0, Math.round(scrollTop + onder - hoogte));
  return null;
}
