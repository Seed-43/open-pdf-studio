# Schermkalibratie: Werkelijke grootte op ware maat (#520)

"Werkelijke grootte" (Ctrl+0, de knop **100%** op het tabblad Start) laat een
PDF zien op zijn echte papiermaat, als het scherm gekalibreerd is.

## Gedrag

| Situatie | Werkelijke grootte |
| --- | --- |
| Niet gekalibreerd (standaard) | zoom = `zoomDpi` / 72: de voorkeur "Schermresolutie voor 100% zoom" (standaard 110 dpi; 96 is de browsermaat) bepaalt wat 100% is. |
| Gekalibreerd | zoom = (CSS-pixels per inch) / 72. Een A4 meet dan 210 mm met een liniaal. De kalibratie gaat voor `zoomDpi`. |

Het percentage in de statusbalk, de ronde zoomstappen (knoppen, toetsen,
Ctrl+wiel) en Werkelijke grootte gebruiken dezelfde definitie van 100%
(`js/core/zoom-display.js`): op een gekalibreerd scherm is 100% de echte
papiermaat, anders `zoomDpi`. De interne zoom (`doc.scale`, MCP
`app_set_zoom`) blijft CSS-pixels per PDF-punt.

## Kalibreren

Voorkeuren > Paginaweergave > Werkelijke grootte (100%) > **Kalibreren...**

1. Houd een betaalpas (85,6 mm breed) of een liniaal tegen het scherm.
2. Kies de referentie en verschuif de schuifregelaar (of gebruik - / +) tot de
   balk precies even lang is als de pas of de liniaal.
3. Of: meet de getoonde balk op met een liniaal, typ de gemeten lengte in mm
   en klik op Toepassen.
4. OK, en daarna **Opslaan** in het voorkeurenvenster.

**Verwijderen** zet dit scherm terug op `zoomDpi` als definitie van 100%.

## Wat de kalibratie NIET verandert

- de paginamaten van de PDF;
- de tekenschaal van de meetgereedschappen (het kalibreren van een tekening
  voor het meten is iets anders en blijft los hiervan);
- de DPI bij exporteren naar een afbeelding;
- de afdrukschaal, ook niet de keuze "Werkelijke grootte" in het printvenster.

De scherpte van het beeld volgt zoals altijd zoom x devicePixelRatio; de
schermschaal van het besturingssysteem telt dus niet dubbel mee.

## Grenzen

- **Per schermschaal, niet per monitor.** De kalibratie wordt bewaard per
  devicePixelRatio (de schermschaal van Windows/macOS/Linux, bv. 125%). Twee
  monitoren met dezelfde schermschaal maar een verschillende pixeldichtheid
  delen dus één waarde; kalibreer dan op de monitor waarop je op ware maat wilt
  kijken.
- **Venster naar een ander scherm slepen.** Stond de weergave op Werkelijke
  grootte en is het andere scherm (met een andere schermschaal) ook
  gekalibreerd, dan springt de zoom naar de werkelijke grootte van dat scherm.
  Is het andere scherm niet gekalibreerd, dan blijft de zoom staan; druk daar
  zo nodig opnieuw op Ctrl+0.
- **Schermschaal of webview-zoom wijzigen** verandert het aantal CSS-pixels per
  inch. Na zo'n wijziging hoort een nieuwe kalibratie bij die nieuwe schaal.
- **Extern bureaublad en beamers** hebben geen vaste fysieke maat; een
  kalibratie is daar niet betrouwbaar.
- Een kalibratie geldt alleen voor het scherm waarop ze gemeten is.

## Techniek

- Voorkeur `screenCalibration`: `{ "<dpr>": <CSS-px per inch> }`, standaard `{}`.
- Rekenwerk: `open-pdf-studio/js/pdf/schermkalibratie.js` (tests in
  `schermkalibratie.test.mjs`).
- Werkelijke grootte: `actualSize()` in `js/pdf/renderer.js`; de definitie van
  100% voor statusbalk en zoomstappen: `js/core/zoom-display.js` (de bron wordt
  gezet in `js/core/preferences.js`).
- Schermwissel: de dpr-bewaking in `js/pdf/pdf-viewport.js`.
