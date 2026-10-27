# Unicode-exportcontract (#678)

De nieuwe suite gebruikt dezelfde `embedOcrFont` en `writeOcrTextLayer` als de
app. Elke fixture heeft een zichtbare pagina én een onzichtbare OCR-pagina.
De controle onderzoekt glyph-id's, zichtbare outlines, ingebedde fontprogramma's,
ToUnicode, PDF.js-extractie en een onafhankelijke MuPDF-WASM-rasterisatie.

Voorbereiden (cache buiten de checkout):

```
OPS_UNICODE_FONT_DIR=/pad/naar/cache node scripts/prepare-unicode-fonts.mjs
OPS_UNICODE_FONT_DIR=/pad/naar/cache node --test js/pdf/unicode-export-contract.test.mjs
```

De CI provisiont de bestanden vóór de unitsuite. Ontbrekende fixtures worden
lokaal zichtbaar overgeslagen; opgegeven maar ongeldige fixtures falen. URLs zijn
vastgezet op commits en SHA-256. De OFL-licenties worden mee opgehaald. De
fixtureverwijzingen zijn afkomstig uit het openbare craft-libs fontmanifest;
er wordt geen upstream implementatie overgenomen.

`check-unicode-browser.mjs` herhaalt de rondgang en canvasweergave in Chromium
tegen Vite (BASE_URL, standaard poort 3042). De Node-suite draait de onafhankelijke
MuPDF-WASM-renderer; dit is geen test van een native MuPDF-bibliotheek.

## Grenzen en gevonden afwijking

Latijnse accenten, Grieks, Cyrillisch, Vietnamees en Thai hebben exacte extractie.
De Thaise fixture is een variable font op de standaardinstelling; andere assen
zijn hiermee niet gekwalificeerd. De bestaande CJK-tekstvak- en ontbrekend-font-
tests blijven nodig voor de echte saver en zijn niet vervangen.

De gekozen Arabische fixture wordt nu expliciet afgewezen met
`PDF_UNMAPPED_SHAPED_GLYPH`: fontkit produceert gevormde glyphs zonder
codePoints, die bij heropenen anders als controletekens terugkomen. Met de
Unicode-bewaking (`embedOcrFont(..., { unicodeGuard: true })`) weigert de
font-embedding zulke runs en ontbrekende glyphs (`PDF_MISSING_GLYPH`). De
OCR-laag gebruikt de bewaking en slaat zo'n woord over; de rest van de laag en
de opslag blijven heel, zoals de OCR-schrijver al deed met woorden die het font
niet kon coderen. Zichtbare tekst (CJK-tekstvakken, MCP-tekst) gebruikt de
bewaking niet: een teken zonder glyph blijft daar een leeg vakje, want een fout
zou de hele opslag laten mislukken. De tests controleren beide fouten met echte
fonts. Dit is een bewaarbeveiliging, geen geslaagde Arabische rondgang.
Shaping blijft ingeschakeld; we verzinnen geen Unicode-koppelingen om de test te
laten slagen. Een correcte ToUnicode/shaping-oplossing en visuele kwalificatie
blijven nodig. Geen claim op correcte RTL-caretposities of volledige tekstbewerking.

Deze suite kwalificeert de gedeelde embedding-/OCR-primitieven. Zij bewijst niet
dat alle bestaande tekstedit-, formulier- of annotatiepaden alle scripts kunnen
opslaan. Uitbreiding van die paden en niet-standaard fontvariaties blijft onderdeel
van #678; de regressie-infrastructuur maakt die gaten nu reproduceerbaar.
