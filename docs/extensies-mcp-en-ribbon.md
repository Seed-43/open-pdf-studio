# Extensies: beheer via MCP en eigen linttabbladen

*Ontwerp voor issue #550 (extensies installeren en herladen via MCP) en
issue #551 (linttabbladen, pictogrammen en opdrachten als extensiebijdrage).
Uitgangspunt is main op c8459398.*

**Stand van zaken.** Gebouwd op de tak `feat/550-551-extension-mcp-ribbon`,
nog niet samengevoegd. Dit document beschrijft wat er gebouwd is; waar de
bouw van het oorspronkelijke ontwerp afweek, staat dat hieronder verwerkt
(§14 vat de afwijkingen samen). Na een review zijn achttien gebreken
verholpen (§15). De eenheidstests en de Rust-tests zijn groen (§11). Nog
open: de live controle opnieuw draaien met de nieuwe stap 9 (verwijderen)
en de bevestiging door de gebruiker van toetsenbord en overloop in de echte
app (§11.3). Beide issues staan open en worden pas gesloten als het werk is
samengevoegd.

---

## 1. Doel

Een lokale agent moet via de MCP-koppeling een `.oppx`-extensie kunnen
installeren, bijwerken en herladen zonder bestandsdialoog en zonder
herstart van de app. Open PDF-tabbladen en niet-opgeslagen wijzigingen
blijven daarbij staan. Als iets misgaat, blijft de vorige werkende versie
actief.

Een extensie moet daarnaast haar eigen bediening als gewoon tabblad in het
lint kunnen aanbieden, met groepen, knoppen, keuzelijsten en een
statusregel. De host tekent dat tabblad; de extensie raakt de DOM niet
aan. Elke knop krijgt een opdracht-id dat ook via `app_list_commands` en
`app_run_command` bruikbaar is.

Beide issues delen één fundament: **een bijdrageregister per extensie**.
Alles wat een extensie registreert, wordt daarin bijgehouden en bij
deactiveren of herladen gegarandeerd opgeruimd.

## 2. Wat er was, en waar het misging

De tabel beschrijft main op c8459398; de rest van dit document beschrijft
de oplossing.

| Onderdeel | Plaats | Probleem |
|---|---|---|
| Native installatie | `src-tauri/src/lib.rs`, `install_plugin` | Wist de bestaande map vóór het uitpakken (fout genegeerd). Geen tussenmap, geen back-up, geen terugweg. |
| Id-controle | `install_plugin`, `uninstall_plugin`, `read_plugin_file` | Weigert alleen `..`, `/` en `\`. Het id `""` of `.` wijst naar de pluginmap zelf, zodat alle extensies gewist worden. Een id als `C:` ontsnapt op Windows via `Path::join`. |
| Lijst | `list_plugins` | Kapotte mappen worden stil overgeslagen. |
| Activeren | `plugin-manager.js`, `loadPlugin` | `activate` wordt synchroon aangeroepen. Een asynchrone fout wordt niet opgevangen. Alleen `true`/`false` als uitkomst, geen foutcode, geen geheugen van mislukte ladingen. |
| Herinstalleren | `reinstallPlugin` | Laadt eerst uit, installeert daarna en negeert de uitkomst van `loadPlugin`. Bij een fout zijn de oude code en de oude bestanden allebei weg. |
| Installeren via het paneel | `ExtensionsPanel.jsx` | `loadInstalledPlugins` slaat al geladen id's over. Bij een update blijft de oude code draaien terwijl er "geïnstalleerd" staat. Een kapotte extensie staat niet in de lijst en kan dus niet verwijderd worden. |
| Opruimen | `plugin-api.js`, `_cleanup` | Ruimt typen, paletten, panelen, selectieluisteraars en documentgebeurtenissen op. Het actieve gereedschap wordt niet teruggezet, er volgt geen hertekening en een gemonteerd eigenschappenpaneel blijft staan. |
| Lint | `Ribbon.jsx`, `ribbonStore.js` | Tabbladen en inhoud zijn hard gecodeerd. Er is geen register, geen toetsenbordbediening en geen `role`/`aria`. |
| Opdrachten | `mcp-bridge.js` | `app_list_commands` klikt de vaste lijst `RIBBON_TAB_ORDER` langs. Extensietabbladen, een ingeklapt lint en knoppen in de "Meer"-uitklap zijn daardoor onzichtbaar. |

## 3. Nieuwe en gewijzigde bestanden

De logica komt in nieuwe, zuivere modules met ingespoten afhankelijkheden.
Die zijn zonder app-testhooks onder `node:test` te testen. Gedeelde
bestanden krijgen alleen kleine toevoegingen, omdat de tak feat/567
tegelijk `plugin-api.js`, `mcp-bridge.js` en de MCP-lijst uitbreidt.

**Nieuw**

| Bestand | Rol |
|---|---|
| `js/plugins/extension-contributions.js` | Bijdragescope per extensie: bijhouden, eigenaarschap, opruimen in omgekeerde volgorde. |
| `js/plugins/svg-pictogram.js` | Strikte SVG-parser: valideert een kleine subset en schrijft die opnieuw uit. |
| `js/plugins/ribbon-tab-registry.js` | Validatie en signaalregister van extensietabbladen, plus het weergavemodel. |
| `js/plugins/extension-commands.js` | Opdrachtregister (`ext:`-id's), uitvoeren, uitzetten en bezet-slot. |
| `js/plugins/extension-lifecycle.js` | Toestandsmodel, installeren, herladen, terugrollen, idempotentie en wachtrij. |
| `js/plugins/opslag-wissel-slot.js` | Opslaan en een extensiewissel sluiten elkaar uit (§7.7). Zuiver; de saver en de levenscyclus importeren het allebei. |
| `js/plugins/plugin-api-stubs.mjs` | Testhulp: laadt de echte `plugin-api.js` onder node, met stubs voor de zware app-modules. |
| `js/tools/keyboard-handlers-stubs.mjs` | Testhulp: laadt de echte `keyboard-handlers.js` onder node, met een stub per import. |
| `js/plugins/extension-mcp.js` | MCP-handlers: invoer controleren en het resultaat vormen. |
| `js/plugins/oppx-testpakket.mjs` | Testhulp: schrijft een ongecomprimeerd ZIP-bestand (eigen CRC32, werkt op Node 20). |
| `js/solid/components/ribbon/ExtensionRibbonTab.jsx` | Tekent één extensietabblad uit het weergavemodel. Bevat ook `ExtensionTabStrip`: de tabknoppen van de extensies met het »-overloopmenu. |
| `js/solid/components/ribbon/ribbon-toetsenbord.js` | Zuivere functies: `volgendeTab` (pijltjesnavigatie) en `verdeelTabbladen` (strook of overloopmenu). |
| `src-tauri/src/extensie_installatie.rs` | Pakketcontrole, transactionele installatie, terugdraaien, herstel na een crash. |
| `scripts/verify-extensies.mjs` (repo-wortel, naast de andere verify-scripts) | Live controle tegen de MCP-testrig. |

**Kleine wijzigingen**

- `js/plugins/plugin-api.js`: twee imports, de vlag `features.ribbonTabs`,
  `registerRibbonTab`/`unregisterRibbonTab`, `_bijdragenOverzicht()`, één
  regel bovenaan `_cleanup` en één onderaan (`_cleanup` geeft de
  waarschuwingen van de scope terug). Daarnaast per `register*`-methode en
  in `onDocumentEvent` en `setNativePanelVisible` één regel
  `scope.eisActief(…)`, en de `unregister*`-methoden halen alleen weg wat
  deze API zelf registreerde (§4).
- `js/plugins/tool-group-state.js`: `clearToolGroups(ids)` en
  `toolGroupIdsOf(paletten)`, zodat opruimen alleen de eigen
  gereedschapsgroepen wist.
- `js/tools/keyboard-handlers.js`: een pijltoets in de tabstrook, een menu
  of een keuzelijst verschuift geen annotaties meer (§5.8).
- `js/plugins/plugin-manager.js`: wordt een dunne laag boven
  `extension-lifecycle.js`. De geëxporteerde namen blijven bestaan voor
  `main.js` en het paneel.
- `js/solid/components/ribbon/Ribbon.jsx` en `RibbonTab.jsx`:
  extensietabbladen, `role`/`aria` en toetsenbord.
- `js/solid/components/ribbon/RibbonButton.jsx`: twee optionele props
  (`extCommand` wordt `data-ext-command`, `pressed` wordt `aria-pressed`) en
  het pictogram volgt de prop, zodat `update(..., { icon })` werkt. Voor de
  ingebouwde knoppen verandert er niets.
- `styles/ribbon.css`: `.ribbon-ext-*`-regels, alleen met themavariabelen.
  De drie statustinten staan als extra selector bij de bestaande
  `.measure-status-*`-regels.
- `styles/dialogs.css`: het label "Via de AI-koppeling" en de foutregel in
  het extensiepaneel.
- `js/mcp-bridge.js`: drie `HANDLERS`-regels, een `ext:`-tak in
  `handleRunCommand`, extensieopdrachten in `handleListCommands` en een
  uitsluiting in de knopselector.
- `js/pdf/saver.js`: één import, en `_savePDFNu` loopt binnen
  `metOpslagSlot` (zie §7.7). De bijbehorende testopzet in
  `js/pdf/save-document.test.mjs` krijgt de nieuwe afhankelijkheid en drie
  tests erbij.
- `mcp-stdio/README.md`: de telling van 62 naar 65.
- `js/solid/components/app-menu/ExtensionsPanel.jsx`: gebruikt de
  levenscyclus en toont ook mislukte extensies.
- `src-tauri/src/lib.rs`: `mod extensie_installatie;`, vijf commando's in
  de `invoke_handler` en de strikte id-controle in de drie bestaande
  commando's.
- `src-tauri/src/mcp_server.rs`, `mcp_tool_meta.rs`,
  `mcp-stdio/tools.json`, `mcpb/manifest.json` en
  `mcp-stdio/brug.test.mjs`: drie nieuwe tools (zie §8.5).
- Alle 39 localemappen in `js/i18n/locales/`: vier nieuwe sleutels (§10).
- `open-pdf-studio/scripts/unit-testlijst.txt`: de nieuwe tests. Nooit in
  `package.json`.

## 4. Bijdrageregister per extensie

`extension-contributions.js` levert per extensie een **scope**:

```js
const scope = maakBijdrageScope(extId);
scope.voegToe(soort, sleutel, opruimen);   // soort: 'ribbonTab' | 'command' | ...
scope.verwijder(soort, sleutel);           // ruimt die ene bijdrage op
scope.lijst();                              // [{ soort, sleutel }]
scope.ruimOp();                             // alles, in omgekeerde volgorde
```

Garanties:

- **Volledig.** Elke registratie via de API loopt via de scope. `ruimOp()`
  roept elke opruimfunctie precies één keer aan.
- **Omgekeerde volgorde.** Wat het laatst is geregistreerd, wordt het
  eerst opgeruimd. Een opdracht verdwijnt zo vóór het tabblad dat hem
  toont.
- **Fout-geïsoleerd.** Een opruimfunctie die gooit, stopt de rest niet.
  De fouten worden verzameld en teruggegeven als waarschuwingen
  (`CLEANUP_FAILED`).
- **Idempotent.** Een tweede `ruimOp()` doet niets. Na `ruimOp()` weigert
  `voegToe` met `EXTENSION_INACTIVE`, zodat een late asynchrone
  registratie van een al gedeactiveerde extensie niets achterlaat.
- **Eigenaarschap.** Een globale tabel `(soort, sleutel) → extId` bewaakt
  de nieuwe soorten (`ribbonTab`, `command`). Een sleutel die bij een
  andere extensie hoort, geeft `CONTRIBUTION_CONFLICT`. Een extensie kan
  dus nooit het tabblad of de opdracht van een andere vervangen of
  verwijderen.

`createPluginApi` maakt de scope aan en roept `scope.ruimOp()` als eerste
regel van `_cleanup` aan. Vanaf dat moment is de API **gesloten**:

- Elke registratie gooit `EXTENSION_INACTIVE`: niet alleen `registerRibbonTab`,
  maar ook `registerAnnotationType`, `registerToolPalette`,
  `registerPropertyPanel`, `registerSelectionListener`, `onDocumentEvent` en
  `setNativePanelVisible` (via `scope.eisActief(soort, sleutel)`). Een
  `activate` die na de tijdgrens doorloopt, laat zo niets in de globale
  registers achter.
- De `unregister*`-methoden halen alleen weg wat deze API zelf registreerde.
  Een oude API (na herladen) kan zo het type, palet of paneel van de nieuwe
  versie niet weghalen; na `_cleanup` doen ze niets.
- `_cleanup` toont het eigenschappenpaneel alleen weer als deze extensie
  het verborg, en wist alleen de gereedschapsgroepen van de eigen paletten
  (`clearToolGroups(toolGroupIdsOf(...))`). Herladen of uitzetten van één
  extensie raakt zo de toestand van andere extensies niet.

De bestaande soorten (annotatietypen, paletten, eigenschappenpanelen,
selectieluisteraars) blijven op hun eigen lijsten in `_cleanup` staan. Zo
blijft de wijziging in `plugin-api.js` klein. Het eigenaarschap tussen
extensies voor die soorten komt later (§13).

**Na het opruimen** doet de levenscyclus (niet `plugin-api.js`) nog drie
dingen die eerder ontbraken. Dat gebeurt één keer per wissel, aan het eind
(na de activatie of na het terugrollen), en na verwijderen of uitzetten. De
levenscyclus geeft daarbij de annotatietypen van de vorige versie mee
(`naOpruimen({ typen })`); de uitvoering staat in `plugin-manager.js`.

1. Was `state.currentTool` een annotatietype van de vorige versie, en is
   het nu geen geregistreerd annotatietype en geen ingebouwd gereedschap
   meer, dan wordt het standaardgereedschap `select` gekozen. Alleen
   gereedschap van de extensie zelf wordt dus teruggezet; registreert de
   nieuwe versie hetzelfde type, dan blijft het gereedschap staan.
2. De annotaties worden opnieuw getekend (`redrawAnnotations`), zodat er
   geen pixels van een verwijderd type blijven staan.
3. Is er een annotatie geselecteerd, dan worden haar eigenschappen opnieuw
   getoond. Het eigenschappenpaneel zoekt zo zijn renderer opnieuw in het
   register op, en een paneel van een verwijderde extensie verdwijnt.

## 5. `registerRibbonTab`

### 5.1 Id's en namespacing

- **Extensie-id** (uit `plugin.json`): kleine letters, cijfers, `-` en
  `.`, bijvoorbeeld `nl.voorbeeld.kozijnen`. Precieze regel in §7.2.
- **Lokaal id** van een tabblad, groep, item of keuze:
  `^[a-z0-9][a-z0-9-]{0,47}$`. Er komt geen punt in voor, zodat de
  samengestelde id's eenduidig blijven.
- **Volledig tab-id**: `<extId>.<lokaal>`, bijvoorbeeld
  `nl.voorbeeld.kozijnen.main`. De extensie mag het lokale of het
  volledige id meegeven. Een volledig id moet met het eigen extensie-id
  plus een punt beginnen, anders volgt `INVALID_CONTRIBUTION`. Ingebouwde
  tab-id's (`home`, `view`, …) bevatten geen punt, dus botsen kan niet.
- **Item-id's** zijn uniek binnen de extensie, over al haar tabbladen
  heen, omdat ze in het opdracht-id terugkomen (§6).
- Extensies met een oud id dat niet aan de strikte regel voldoet, laden
  zoals nu. `registerRibbonTab` weigert dan wel met
  `INVALID_CONTRIBUTION`.

### 5.2 Descriptor

```js
if (api.features?.ribbonTabs === true) {
  const tab = api.registerRibbonTab({
    id: 'main',                                   // of 'nl.voorbeeld.kozijnen.main'
    label: { en: 'Frames', nl: 'Kozijnen' },      // of een gewone string
    icon: '<svg viewBox="0 0 24 24">…</svg>',    // of { builtin: 'extensionsIcon' }
    order: 0,                                     // volgorde binnen deze extensie
    groups: [
      {
        id: 'place', label: { en: 'Place', nl: 'Plaatsen' },
        items: [
          { type: 'action', id: 'frame', label: 'Kozijn', title: 'Plaats een kozijn',
            icon: '<svg viewBox="0 0 24 24">…</svg>', size: 'large',
            onRun: async (ctx) => { /* ctx: { source: 'ui' | 'mcp', commandId } */ } },
          { type: 'dropdown', id: 'profile', label: 'Profiel',
            options: [{ id: 'wood', label: 'Hout' }, { id: 'alu', label: 'Aluminium' }],
            value: 'wood',
            onChange: async (optionId, ctx) => { /* … */ } },
          { type: 'status', id: 'count', label: 'Geplaatst', text: '0', tone: 'neutral' },
        ],
      },
    ],
  });

  tab.update('count', { text: '3', tone: 'success' });
  tab.update('frame', { disabled: true });
  tab.dispose();                                  // of api.unregisterRibbonTab('main')
}
```

- `label` en `title` zijn een string of een object `{ taalcode: tekst }`.
  De host kiest de actieve taal, valt terug op `en` en daarna op de eerste
  waarde. Bij een taalwissel wordt opnieuw gekozen.
- `registerRibbonTab` valideert alles vooraf en gooit bij een fout een
  `ExtensionContributionError` met `code`. Er wordt dan niets
  geregistreerd. Gebeurt dit binnen `activate`, dan mislukt de activatie
  als geheel (§7.3).
- De teruggegeven handle heeft `id`, `update(itemId, patch)` en
  `dispose()`. `update` mag alleen `label`, `title`, `disabled`, `active`,
  `text`, `tone`, `value`, `options` en `icon` wijzigen, en alleen de velden
  die bij de soort horen (een actie: `label`, `title`, `disabled`,
  `active`, `icon`; een keuzelijst: `label`, `title`, `disabled`, `value`,
  `options`; een status: `label`, `text`, `tone`). Met dezelfde validatie;
  eerst wordt alles gecontroleerd, dan pas toegepast. Nieuwe `options`
  krijgen nieuwe opdrachten; bestaat de huidige waarde niet meer, dan wordt
  de eerste keuze de waarde. Na `dispose()` of deactiveren doet de handle
  niets meer (stil, geen fout).
- Onbekende velden in de descriptor, een groep, een item of een keuze
  geven `INVALID_CONTRIBUTION`. Zo merkt een extensie die een nieuwer veld
  gebruikt dat een oudere app het niet kent.

### 5.3 Soorten items

| Soort | Weergave | Velden | Opdracht |
|---|---|---|---|
| `action` | `RibbonButton` met `data-ext-command`. `size: 'large'` (standaard) is de 66 px hoge knop. Opeenvolgende `medium`- of `small`-items worden automatisch in een `RibbonButtonStack` gezet (2 medium of 3 small). Zolang de opdracht loopt, is de knop uitgeschakeld. | `label`, `title`, `icon`, `size`, `disabled`, `active` (aan/uit-weergave), `onRun(ctx)` (verplicht) | `ext:<extId>:<itemId>` |
| `dropdown` | Een rij met `.ribbon-input-label` en een native `select.ribbon-form-select`. Native, zodat de lijst niet wordt afgeknipt door `overflow: hidden` van `.ribbon-groups-adaptive` en het toetsenbord gratis werkt. | `label`, `title`, `options[{id,label}]` (1–50), `value` (standaard de eerste keuze), `disabled`, `onChange(optionId, ctx)` (optioneel) | per keuze `ext:<extId>:<itemId>=<optionId>` |
| `status` | Een label met een korte tekst (`.ribbon-ext-status`, `role="status"`). | `label`, `text` (≤ 40 tekens), `tone`: `neutral`, `success`, `warning` of `error` | geen; alleen-lezen |

Opeenvolgende keuzelijsten en statusregels komen in één kolom
(`.ribbon-ext-kolom`) van hooguit drie rijen van 22 px, zoals de
invoerrijen van de ingebouwde tabbladen.

Bij `onChange` zet de host de nieuwe waarde pas na een geslaagde
afhandeling. Bij een fout blijft de oude waarde staan; de native `select`
springt dan ook terug.

### 5.4 Pictogrammen

`icon` is een van twee vormen:

- `{ builtin: '<exportnaam>' }`: een bestaand pictogram uit
  `js/solid/data/ribbonIcons.js`. Een onbekende naam geeft
  `INVALID_CONTRIBUTION`.
- **SVG-tekst.** `svg-pictogram.js` parseert die met een eigen, kleine
  tokenizer en **weigert** alles buiten de subset. Er wordt niet
  "schoongemaakt". Daarna schrijft de host de SVG opnieuw uit de
  geparseerde boom. Alleen die herschreven tekst komt in `innerHTML` van
  `RibbonButton`.
  - Elementen: `svg`, `g`, `path`, `circle`, `ellipse`, `line`,
    `polyline`, `polygon`, `rect`.
  - Attributen, per element alleen de eigen: `svg` mag `viewBox`, `xmlns`
    (alleen `http://www.w3.org/2000/svg`), `width` en `height`; `g`
    `transform`; `path` `d`; `circle` `cx`, `cy`, `r`; `ellipse` `cx`,
    `cy`, `rx`, `ry`; `line` `x1`, `y1`, `x2`, `y2`; `polyline` en
    `polygon` `points`; `rect` `x`, `y`, `width`, `height`, `rx`, `ry`. De
    vormen mogen ook `transform`. Overal toegestaan zijn de opmaakattributen
    `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`,
    `stroke-miterlimit`, `stroke-dasharray`, `stroke-dashoffset`,
    `fill-rule`, `clip-rule`, `opacity`, `fill-opacity` en
    `stroke-opacity`. Elke waarde wordt getoetst (getallen, paddata,
    `transform`-functies, vaste keuzes); een dubbel attribuut of een waarde
    zonder aanhalingstekens wordt geweigerd.
  - Alleen `svg` en `g` mogen kinderen hebben; een geneste `svg` is niet
    toegestaan.
  - Kleurwaarden: `none`, `currentColor` of hex (`#rgb`, `#rrggbb`,
    `#rrggbbaa`). Geen `url(...)`.
  - Niet toegestaan: `id`, `class`, `style`, `href`, `on*`, tekst,
    commentaar, CDATA, doctype, processing instructions (`<?xml …?>`) en
    entiteiten (elke `&`).
  - Het hoofdelement heeft een `viewBox` met vier getallen. Maximaal 8 KB
    en 200 elementen.
  - Geadviseerd is `stroke="currentColor"` op een 24×24-`viewBox`, zoals
    de ingebouwde pictogrammen. Dan volgt het pictogram vanzelf het thema.
    Breedte en hoogte zet de host via CSS.

Het tabbladpictogram staat op 12×12 px links van het tablabel en in het
overloopmenu van de tabstrook (§5.7). Zonder pictogram toont het tabblad
alleen tekst, net als de ingebouwde tabbladen.

### 5.5 Thema en maten

De host tekent alles met de bestaande klassen: `.ribbon-group`,
`.ribbon-btn`, `.ribbon-btn-stack`, `.ribbon-form-select`,
`.ribbon-input-row` en `.ribbon-input-label`. Die gebruiken al de
`--theme-ribbon-*`-variabelen, dus alle zeven thema's werken zonder extra
werk.

Een extensie kan geen CSS, `style` of klassen meegeven. De nieuwe
`.ribbon-ext-*`-regels gebruiken uitsluitend themavariabelen. Voor de
statustinten worden dezelfde kleuren hergebruikt als de bestaande
`.measure-status-success/-warning/-error`: `.ribbon-ext-tone-success`,
`-warning` en `-error` staan als extra selector in die drie regels, en
`neutral` gebruikt `--theme-ribbon-input-text`. Er komen dus geen nieuwe
kleuren bij. Het »-menu hergebruikt `.ribbon-overflow-flyout` van de
"Meer"-uitklap.

De maten zijn die van het lint: een inhoud van 94 px hoog, grote knoppen
van 66 px, labels van 10 px en groeplabels van 9 px. De muiscursor blijft
standaard (`base.css` dwingt dat al af voor `.ribbon-container *`).

### 5.6 Plaats, actief tabblad en inklappen

- Extensietabbladen staan na "Instellingen" (`help`) en vóór de
  contextuele tabbladen. Ze zijn gesorteerd op extensie-id en daarna op
  `order`. Daardoor springt een tabblad niet naar een andere plek als de
  extensie herlaadt.
- De tabknop is dezelfde `RibbonTab`, met `data-tab="<volledig id>"`. Het
  bestaande terugzetten van het tabblad in `_lintKnoppenPerTab` werkt
  daardoor ook voor extensietabbladen.
- `activeTab` blijft een gewone string. `Ribbon.jsx` krijgt een laatste
  `<Match>` die voor een geregistreerd extensie-id `ExtensionRibbonTab`
  tekent, binnen de `ErrorBoundary` die al geïmporteerd is. De
  terugvaltekst daarvan is `ribbon.common.extensionTabFailed`.
  `ExtensionRibbonTab` houdt het weergavemodel in een Solid-store met
  `reconcile`: een `update()` werkt alleen de gewijzigde velden bij, zodat
  bijvoorbeeld een statusupdate de focus in een keuzelijst niet wegneemt.
- Het register kent het actieve tabblad via `lintRegister.koppelLint({ lees,
  zet })`; `Ribbon.jsx` koppelt het aan `ribbonStore`.
- **Verdwijnt het actieve tabblad** (dispose, unload of een mislukte
  herlading), dan zet het register `activeTab` op `home`. Een effect in
  `Ribbon.jsx` vangt de rest op: een `activeTab` dat geen ingebouwd en
  geen geregistreerd tabblad is, wordt `home`. Dat dekt ook
  `_lastNormalTab` in `ui-state.js`, dat naar een inmiddels verdwenen
  tabblad zou kunnen terugkeren.
- **Bij herladen** onthoudt de levenscyclus of een tabblad van deze
  extensie actief was. Registreert de nieuwe versie hetzelfde id, dan
  wordt het weer actief. De gebruiker blijft dus op het tabblad staan.
- **Inklappen** werkt zoals bij ingebouwde tabbladen. `ribbonCollapsed`
  verbergt de inhoud en de tabknoppen blijven werken. Een extensie kan het
  inklappen niet zelf bedienen. Opdrachten via MCP werken ook bij een
  ingeklapt lint, omdat ze uit het register komen en niet uit de DOM (§6).

### 5.7 Overloop

- **Groepen.** De inhoud van een extensietabblad is
  `<AdaptiveGroups>` met elke `RibbonGroup` als direct kind. Daardoor
  werken beide bestaande stappen vanzelf: eerst alleen pictogrammen, dan
  de rechtse groepen naar de "Meer"-uitklap. In die uitklap blijven native
  `select`-lijsten gewoon werken.
- **Tabstrook.** De extensietabknoppen staan in een eigen
  `.ribbon-ext-tabs`-blok met `min-width: 0`. Een tablabel is maximaal
  120 px breed met een beletselteken; het volledige label staat in
  `title`. Past het blok niet meer, dan gaan de achterste extensietabbladen
  naar een compact menu achter een »-knop (titel
  `ribbon.common.moreTabs`). Dat menu gebruikt `position: fixed`, net als
  `ColorPickerButton`, zodat het niet wordt afgeknipt; pijl omhoog en omlaag
  lopen door de items, Escape sluit het. Het actieve tabblad blijft altijd
  zichtbaar. De verdeling komt uit een zuivere functie
  `verdeelTabbladen(breedtes, beschikbaar, actief)`, die met
  `ResizeObserver` op de tabstrook wordt aangestuurd en ook na elke
  tabwissel opnieuw meet. De »-knop telt voor 26 px
  (`MEER_KNOP_BREEDTE`). Verborgen tabknoppen blijven in de DOM (klasse
  `ribbon-ext-tab-verborgen`), zodat `.ribbon-tab[data-tab=…]` ze altijd
  vindt.
- **Limieten** per extensie: maximaal 3 tabbladen, 8 groepen per tabblad
  en 12 items per groep. Een tablabel is maximaal 24 tekens, overige labels
  maximaal 40.

### 5.8 Toetsenbord en toegankelijkheid

Het lint heeft nu geen toetsenbordbediening. De oplossing geldt voor de hele
tabstrook, zodat extensietabbladen zich gedragen als de ingebouwde:

- `.ribbon-tabs` krijgt `role="tablist"`. Elke `RibbonTab` krijgt
  `role="tab"`, `aria-selected` en een rondgaande `tabindex`: 0 op het
  actieve tabblad, −1 op de andere. Het actieve tabblad krijgt
  `aria-controls` naar zijn eigen inhoud (`#tab-<id>`, zoals `#tab-home`;
  een extensietabblad `#tab-<volledig id>` met `role="tabpanel"`). De
  bestandsknop opent een menu en is daarom geen `tab`; hij houdt zijn
  gewone tabindex en doet niet mee met de pijltjes.
- **Pijl links en rechts** (gespiegeld bij `dir="rtl"`), **Home** en
  **End** verplaatsen de focus en activeren het tabblad.
  `ribbon-toetsenbord.js` levert daarvoor de zuivere functie
  `volgendeTab(tabs, huidig, toets, rtl)`. **Enter** en **spatie** werken al
  via de native `<button>`; op het bestandstabblad openen ze het menu. Een
  toets met Alt, Ctrl, Meta of Shift, of een al afgehandelde toets, laat de
  tabstrook liggen.
- **Geen dubbel effect.** De globale toetsafhandeling
  (`keyboard-handlers.js`) verschuift met de pijltjes de geselecteerde
  annotaties. Een pijltoets die al is afgehandeld (`defaultPrevented`) of
  waarvan het doel in een `[role="tablist"]`, `[role="tab"]`,
  `[role="menu"]`, `[role="menubar"]`, `[role="listbox"]`,
  `[role="radiogroup"]`, `select` of `.ribbon-tabs` ligt, verschuift niets
  en bladert niet. Zonder die regel wisselde pijl rechts in de tabstrook van
  tabblad én verschoof hij de selectie, met een ongedaan-stap.
- **Geen omhulling rond de inhoud.** De inhoud van een tabblad
  (`.ribbon-content`) blijft een direct kind van `.ribbon-container`.
  Bestaande extensies verbergen de ingebouwde inhoud met een kindselector
  (`.x > .ribbon-content`); een omhulling, ook met `display: contents`,
  breekt dat, want selectors volgen de DOM-boom. Met **Tab** ga je via de
  inklapknop de groep in. Knoppen en `select` zijn native en dus
  bedienbaar.
  Uitgeschakelde items krijgen `disabled`. Een `active`-actie krijgt
  `aria-pressed`. Een statusitem krijgt `role="status"`.
- `:focus-visible` krijgt een kader in `--theme-ribbon-tab-active-border`.
  De cursor blijft standaard.
- Staat de focus in een tabblad dat verdwijnt, dan gaat de focus naar de
  knop van het nieuwe actieve tabblad. `Ribbon.jsx` houdt daarvoor bij of
  de focus in de tabstrook stond (`focusin`/`focusout`, waarbij een knop
  die net uit de DOM verdwijnt niet als "focus weg" telt).
- Sneltoetsen en Alt-toetstips vallen buiten deze issues.

### 5.9 Fouten bij registratie

| Code | Wanneer |
|---|---|
| `INVALID_CONTRIBUTION` | Ongeldig id, label, item, pictogram of optie, een onbekende `builtin`, of een volledig id met een vreemd voorvoegsel. |
| `CONTRIBUTION_CONFLICT` | Het tab- of item-id is al geregistreerd door deze of een andere extensie. |
| `LIMIT_EXCEEDED` | Meer tabbladen, groepen, items of opties dan toegestaan. |
| `EXTENSION_INACTIVE` | Een registratie na deactiveren, van welke soort ook (§4). |

Dezelfde extensie kan een tabblad met hetzelfde id pas opnieuw registreren
na `dispose()`. Zo kunnen er nooit dubbele tabbladen ontstaan.

## 6. Opdracht-id's voor extensies

Elke actie en elke keuze van een keuzelijst krijgt bij registratie een
opdracht in `extension-commands.js`. Dat register is de enige bron. Een
klik in het lint en een MCP-aanroep lopen langs hetzelfde codepad
(`voerExtensieOpdrachtUit(id, { source })`).

- `ext:<extId>:<itemId>` voor een actie, bijvoorbeeld
  `ext:nl.voorbeeld.kozijnen:frame`.
- `ext:<extId>:<itemId>=<optionId>` voor een keuze, bijvoorbeeld
  `ext:nl.voorbeeld.kozijnen:profile=alu`.

Een `:` en een `=` komen in geen enkel id voor, dus de opdracht-id's zijn
eenduidig.

**`app_list_commands`** (`handleListCommands`) voegt achter de lint- en
gereedschapsopdrachten de extensieopdrachten toe, met hetzelfde filter:

```json
{ "command": "ext:nl.voorbeeld.kozijnen:frame", "tab": "nl.voorbeeld.kozijnen.main",
  "label": "Kozijn", "title": "Plaats een kozijn", "disabled": false, "active": false,
  "stableId": true, "extension": "nl.voorbeeld.kozijnen", "kind": "action" }
```

- Bij een keuze is `kind` gelijk aan `option` en geeft `active` aan of
  het de huidige waarde is.
- Het resultaat krijgt een extra telling `extensionCommands`. De bestaande
  velden blijven ongewijzigd.
- Extensieopdrachten komen uit het register en verschijnen dus ook als het
  lint is ingeklapt, het tabblad niet actief is of de groep in de
  "Meer"-uitklap zit.
- Extensieknoppen krijgen geen DOM-`id` maar `data-ext-command="<id>"`, en
  `LINT_KNOP_SELECTOR` wordt `.ribbon-group .ribbon-btn:not([data-ext-command])`.
  Ze verschijnen daardoor nooit dubbel als `ribbon:#…` of `ribbon:<tab>:<n>`,
  en de positionele nummering van ingebouwde knoppen verandert niet.

**`app_run_command`** (`handleRunCommand`) krijgt bovenaan één tak voor
`ext:`:

- Een onbekend id geeft `{ ok: false, code: 'UNKNOWN_COMMAND' }`.
- Een uitgeschakelde opdracht wordt geweigerd met
  `{ ok: false, found: true, disabled: true, code: 'COMMAND_DISABLED' }`,
  net als bij lintknoppen.
- Loopt dezelfde opdracht nog, dan volgt `COMMAND_BUSY`. Dat vangt ook
  dubbelklikken op.
- Is de extensie aan het wisselen, dan volgt `EXTENSION_BUSY`.
- `onRun` en `onChange` mogen asynchroon zijn. De host wacht maximaal 15 s
  (de Rust-kant wacht 20 s) en geeft daarna `COMMAND_TIMEOUT`. Een fout
  wordt `COMMAND_FAILED` met de foutmelding.
- Bij succes: `{ ok: true, command, extension, result }`. `result` is de
  JSON-gekloonde terugkeerwaarde, maximaal 64 KB; anders wordt het
  weggelaten met de waarschuwing `RESULT_TOO_LARGE`. Een waarde die niet
  naar JSON kan (bijvoorbeeld een kringverwijzing), wordt weggelaten met
  `RESULT_NOT_SERIALIZABLE`. Zonder terugkeerwaarde ontbreekt `result`.
- Het bezet-slot hoort bij één uitvoering. Na `COMMAND_TIMEOUT` loopt de
  belofte van de extensie nog; het slot gaat pas los als die klaar is.
- Het lint voert een knop of keuze uit met `source: 'ui'`; een mislukte
  uitvoering komt in de console (`[extensies] …`).

De beschrijving van `app_list_commands` krijgt er één zin bij: *"Extension
actions appear as 'ext:<extensionId>:<itemId>'."* Het manifest neemt alleen
de eerste zin over, dus dat verandert niet.

## 7. Levenscyclus: installeren, bijwerken, herladen

### 7.1 Toestandsmodel

`extension-lifecycle.js` houdt per extensie één record bij:

| Veld | Betekenis |
|---|---|
| `id`, `name`, `version` | Uit de geladen of anders de geïnstalleerde manifest. |
| `description`, `author` | Uit dezelfde manifest, voor het extensiepaneel. |
| `installed`, `installedVersion` | Staat het pakket op schijf, en welke versie. |
| `installedVia` | `ui` of `mcp`: wie het pakket op schijf heeft gezet (uit `.opds-installatie.json`). |
| `loaded` | De module is geïmporteerd. |
| `activated` | `activate` is geslaagd en de extensie draait. |
| `status` | `active`, `failed`, `notLoaded` (geïnstalleerd, nog niet geprobeerd of uitgezet) of `busy` (er loopt een wissel). |
| `error` | `{ code, message, at }` van de laatste mislukking, anders `null`. Na een teruggerolde update blijft de fout staan terwijl de vorige versie `active` is. |
| `source` | `ui`, `mcp` of `startup`: wie de laatste wijziging deed. |
| `lastChange` | `{ action, at, source }`; `action` is `installed`, `updated`, `reloaded`, `loaded` of `unloaded`. |
| `bron` | De tekst van de draaiende `index.js`, in het geheugen, om naar terug te kunnen. Komt niet in de lijst. |

Alle wijzigende bewerkingen (installeren, herladen, verwijderen, uitzetten,
laden bij het opstarten) lopen door **één wachtrij**. Twee bewerkingen
raken elkaar dus nooit. Wie wil weten dat er iets veranderd is (het
extensiepaneel), meldt zich aan met `abonneer(fn)`: na elke bewerking en
bij begin en einde van een wissel volgt een melding.

De levenscyclus krijgt al haar afhankelijkheden ingespoten
(`maakLevenscyclus({ invoke, importeer, maakApi, naOpruimen, lint })`); het
exemplaar van de app staat in `plugin-manager.js` (`levenscyclus`).
`deactivate` mag 5 s duren. Voor `activate` geldt een tijdgrens van 10 s,
met een verschil per bron:

- **MCP** (`bron: 'mcp'`): een `activate` die niet op tijd klaar is, is
  mislukt (`ACTIVATION_TIMEOUT`) en wordt teruggerold. Eerst roept de host
  de `deactivate` van die module aan (met haar eigen tijdgrens), dan
  `_cleanup`. Zo blijft een "al actief"-vlag in de module niet staan en is
  ze daarna opnieuw te activeren.
- **Opstarten en het extensiepaneel** (`startup`, `ui`): een trage
  `activate` is geen fout. De extensie blijft actief met haar registraties
  en de waarschuwing `ACTIVATION_SLOW`; de levenscyclus gaat verder.
  Mislukt die `activate` later alsnog, dan zet de levenscyclus de extensie
  uit, ruimt op en zet de status op `failed` met `ACTIVATION_FAILED`.

### 7.2 Native: transactionele installatie (`extensie_installatie.rs`)

**Strikte id-controle** (`valideer_extensie_id`, in JS
`isStriktExtensieId`), voor elke nieuwe installatie, ook in de bestaande
`install_plugin`. Een pakket met een oud id mag alleen een bestaande
installatie met precies dat id (zelfde map, zelfde hoofdletters)
bijwerken, zodat "Herladen" in het paneel ook voor zulke extensies werkt:

- De regex is
  `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$`,
  met een lengte van 1–64. De Rust-kant controleert dezelfde regel zonder
  regex-crate.
- Het eerste segment mag geen Windows-apparaatnaam zijn: `con`, `prn`,
  `aux`, `nul`, `com1`–`com9` of `lpt1`–`lpt9`.
- Daarmee zijn `""`, `.`, `C:`, `a/b` en `..` uitgesloten.
- Bestaande installaties met een afwijkend id blijven laden. Daarom
  accepteren `read_plugin_file` en `uninstall_plugin`
  (`controleer_bestaand_id`) naast een strikt id ook een veilig oud id:
  precies één gewone mapnaam, hooguit 128 tekens, zonder `/`, `\`, `:`,
  `*`, `?`, `"`, `<`, `>`, `|` of stuurtekens, niet beginnend met een punt,
  niet eindigend op een punt of spatie en geen apparaatnaam. `""`, `.`,
  `..`, `C:` en `a/b` blijven dus geweigerd. Zulke extensies staan in de
  lijst met `legacyId: true`; `registerRibbonTab` weigert ze (§5.1).
- `uninstall_plugin` loopt onder hetzelfde globale wisselslot als de
  installatie.
- **Hoofdletters.** Staat er al een map die alleen in hoofdletters van het
  id afwijkt (`Nl.A` tegenover `nl.a`), dan weigert de installatie met
  `ID_CASE_CONFLICT`. Op NTFS is dat dezelfde map: zonder deze regel werd
  de oude installatie stil vervangen terwijl de oude extensie (een ander
  record in de levenscyclus) bleef draaien.

**Pakketcontrole** (`inspecteer_pakket(pad)`) gebeurt op de bytes die één
keer in het geheugen zijn gelezen. Wat gecontroleerd en geïnstalleerd
wordt, is dus precies hetzelfde.

- Het pad moet absoluut zijn: geen relatief pad, geen `\\?\` of `\\.\`,
  geen URL. De extensie moet `.oppx` zijn (hoofdletters maken niet uit). Na
  `canonicalize` moet het een gewoon bestand zijn. Anders volgt
  `PATH_NOT_ALLOWED` of `FILE_NOT_FOUND`.
- **Netwerkshares alleen via de dialoog.** `extensie_inspecteer` en
  `extensie_installeer` krijgen de bron mee (`ui` of `mcp`). Via MCP is
  een UNC-pad (`\\server\…`) verboden, en ook na `canonicalize`: een
  netwerkschijf met een stationsletter of een koppeling naar een share
  wordt dan een `\\?\UNC\…`-pad (`is_netwerkpad`) en geeft
  `PATH_NOT_ALLOWED`. Wat de gebruiker zelf in de bestandsdialoog kiest,
  mag op een share staan, zoals vóór deze issues. Op Linux en macOS is een
  gekoppelde netwerkmap niet van een lokale map te onderscheiden.
- Het bestand is hooguit 20 MB, het ZIP heeft hooguit 1000 items en is
  uitgepakt hooguit 100 MB. Dat geldt ook voor de dialoog (bescherming
  tegen een ZIP-bom); de foutmelding in het paneel noemt de grens.
- Elk item moet een veilige naam hebben: `enclosed_name()` moet slagen, en
  daarnaast weigert de host elke naam met een `\`, een begin-`/`, een leeg,
  `.`- of `..`-segment, een `:`, `*`, `?`, `"`, `<`, `>`, `|` of stuurteken,
  een segment dat op een punt of spatie eindigt of een apparaatnaam is.
  Symbolische koppelingen zijn niet toegestaan, en segmenten die met
  `.opds-` beginnen zijn gereserveerd. Twee items die alleen in
  hoofdletters verschillen (`plugin.json` en `PLUGIN.JSON`) keuren het
  pakket ook af: op NTFS zou het tweede het gecontroleerde eerste
  overschrijven. Het uitpakken maakt elk bestand bovendien met
  `create_new`, zodat nooit een al uitgepakt bestand wordt overschreven.
  Eén fout item keurt het hele pakket af (`PACKAGE_INVALID`); vroeger
  werden zulke items stil overgeslagen.
  Bij het uitpakken telt de host de werkelijk uitgepakte bytes, zodat een
  ZIP met een te lage opgegeven grootte de 100 MB niet kan omzeilen.
- In de wortel staat `plugin.json`: hooguit 256 KB, een JSON-object, een
  geldig `id`, en een optionele `version` (string van hooguit 64 tekens) en
  `name`. Anders volgt `MANIFEST_INVALID`. `description` en `author` worden
  meegelezen als ze een string zijn.
- In de wortel staat ook `index.js`, als UTF-8. De lader gebruikt die vast
  als ingang. Anders volgt `ENTRY_MISSING`.
- De uitkomst is `{ id, name, version, description, author, sha256,
  entries, bytes }`.

**Indeling op schijf** onder `<lokale datamap>/OpenPDFStudio/plugins/`:

```
<id>/                          actieve installatie, met .opds-installatie.json
                               { sha256, version, installedAt, source }
.opds-staging/<token>/         uitgepakt pakket vóór de wissel
.opds-backup/<token>/          vorige installatie, tot bevestiging
.opds-transacties/<token>.json journaal { id, fase, backup, aangemaakt, eigenaar, pid }
.opds-transacties/<eigenaar>.levend   (Windows) exclusief open zolang dat proces leeft
```

Een strikt id begint nooit met een punt, dus deze mappen botsen niet met
een extensie. De lijst slaat namen die met een punt beginnen over.

Het `<token>` is 32 hexadecimale tekens; een ander token wordt geweigerd
(`TRANSACTION_UNKNOWN`), zodat het nooit als pad kan dienen. Het journaal
wordt eerst als `.tmp` geschreven en dan hernoemd. Het kent vier fasen,
zodat het herstel weet wat er al verplaatst is:

| Fase | Betekenis | Herstel |
|---|---|---|
| `voorbereid` | Geschreven vóór het uitpakken; de tussenmap hoort zo al bij een transactie. Nog niets verplaatst, of alleen de oude installatie naar de back-up. | Staat de back-up er en `<id>/` niet, dan gaat de back-up terug. |
| `oud-weg` | De oude installatie staat in de back-up (of er was er geen); `<id>/` is leeg of de onbevestigde nieuwe. Ook bij een eerste installatie. | `<id>/` weg, back-up terug. |
| `gewisseld` | De nieuwe staat op haar plek. | `<id>/` weg, back-up terug. |
| `bevestigd` | De installatie geldt. | Alleen opruimen: back-up, tussenmap en journaal weg; niets terugdraaien. |

**Eigenaar.** Een tab losmaken start een tweede app-proces met dezelfde
pluginmap, en dat draait bij het opstarten ook het herstel. Elk journaal
heeft daarom een `eigenaar` (een token per proces) en een `pid`. Het
herstel draait alleen journalen terug van een proces dat niet meer bestaat;
die van een levend proces blijven met hun tussenmap en back-up staan. Op
Windows houdt elk proces `<eigenaar>.levend` zonder delen open: kan een
ander proces dat bestand niet openen (`ERROR_SHARING_VIOLATION`), dan leeft
de eigenaar, ook als een pid opnieuw is uitgedeeld. Elders geldt de `pid`
(`/proc/<pid>` of `kill -0`). Een journaal zonder eigenaar is van een oud
proces.

**Foutpaden.** Mislukt een stap nadat de oude installatie al naar de
back-up is verplaatst, dan zet de installatie haar meteen terug. Alleen als
dat lukt, verdwijnen journaal en tussenmap; anders blijft het journaal
staan, zodat het herstel het afmaakt en de back-up niet als wees wordt
opgeruimd. Ook `extensie_terugdraaien` laat het journaal staan als
terugzetten niet lukt.

**Een open transactie voor hetzelfde id.** Een nieuwe installatie kijkt
eerst naar open journalen voor hetzelfde id (hoofdletters tellen niet). Een
bevestigd journaal wordt opgeruimd; een van een proces dat niet meer
bestaat eerst teruggedraaid. Een onbevestigd journaal van een levend proces,
ook van dit proces zelf, geeft `TRANSACTION_PENDING`: anders draait het
herstel het later terug en verdwijnt de nieuwe installatie mee.

**Commando's** (Tauri). Fouten komen terug als JSON-tekst
`{"code","message"}`.

| Commando | Werking |
|---|---|
| `extensie_lijst(herstel?)` | `{ extensions: [{ id, name, version, description, author, sha256, source, legacyId }], problems: [{ folder, code, message }], recovered }`. Kapotte mappen staan nu in `problems` in plaats van stil te verdwijnen (een ontbrekende of kapotte `plugin.json`, een id dat niet bij de map past: `MANIFEST_INVALID`; geen `index.js`: `ENTRY_MISSING`). Met `herstel: true` gaat eerst het herstel van §7.6 vooraf; `recovered` geeft dan wat er is teruggedraaid en opgeruimd. Zo blijft het bij vijf commando's. |
| `extensie_inspecteer(pad, bron)` | Pakketcontrole zonder iets te schrijven, met de padregels van de bron. |
| `extensie_installeer(pad, beleid, verwachteSha256, bron)` | Controleert het pakket opnieuw en vergelijkt de hash (anders `PACKAGE_CHANGED`). Weigert een id in andere hoofdletters (`ID_CASE_CONFLICT`) en een open transactie voor hetzelfde id (`TRANSACTION_PENDING`). Past het vervangbeleid toe (§8.2), schrijft het journaal en pakt uit in de tussenmap. Daarna volgt de wissel: de oude `<id>/` gaat naar de back-up en de tussenmap wordt `<id>/`. Mislukt een hernoeming of het bijwerken van het journaal, dan gaat alles meteen terug zoals het was (zie "Foutpaden"). Een globale mutex voorkomt gelijktijdige wissels in dit proces. `bron` (`ui` of `mcp`) bepaalt de padregels en komt in `.opds-installatie.json`. Uitkomst: `{ outcome: 'installed' \| 'updated' \| 'unchanged', transactie, previousVersion, id, version, sha256 }`. Bij `unchanged` wordt niets geschreven en is `transactie` `null`. |
| `extensie_bevestig(transactie)` | Zet eerst het journaal op `bevestigd` (vanaf dan geldt de installatie), en ruimt dan back-up, tussenmap en journaal op. Mislukt dat opruimen, dan maakt het herstel het af zonder iets terug te draaien. Mislukt het vastleggen zelf, dan volgt een fout en blijft de transactie onbevestigd. |
| `extensie_terugdraaien(transactie)` | Volgens de fase: verwijdert de nieuwe `<id>/` en zet de back-up, als die er is, weer op `<id>/`; bij een eerste installatie blijft er niets achter. Daarna verdwijnen de tussenmap en het journaal. Uitkomst: `{ restoredVersion, id, restored }`. |

Een mislukte bevestiging is geen succes meer: de levenscyclus probeert
`extensie_bevestig` drie keer (met een korte, oplopende pauze). Lukt het
dan nog niet, dan zet ze de nieuwe versie weer uit, draait de transactie
bewust terug en activeert de vorige versie. Het resultaat is `ok: false`
met code `CONFIRM_FAILED` (§7.4). Vroeger kwam er `ok: true` met een
waarschuwing, terwijl het herstel bij de volgende start de update stil
ongedaan maakte.

De logica staat in gewone functies met de pluginmap als parameter. Zo zijn
ze met een tijdelijke map te testen zonder Tauri.

### 7.3 Installeren en bijwerken: volgorde in de WebView

1. **Invoer controleren** in `extension-mcp.js`. Fout:
   `INVALID_ARGUMENT`.
2. **Idempotentie** (§8.2). Een bekende sleutel geeft het bewaarde
   resultaat terug.
3. **Wachtrij in.**
4. `extensie_inspecteer`. Daarmee zijn het id en de versie bekend.
5. `extensie_installeer`. Bij `unchanged`:
   - Draait de extensie al, dan volgt meteen `ok` met
     `outcome: 'unchanged'`.
   - Draait ze niet (eerder mislukt), dan volgt een activatiepoging zoals
     bij herladen.
6. **Nieuwe code lezen en importeren** (`read_plugin_file` → Blob →
   `import()`), **vóór** de oude versie wordt uitgezet. Een syntax- of
   importfout geeft `MODULE_LOAD_FAILED`, daarna `extensie_terugdraaien`.
   De oude versie heeft dan niets gemerkt.
7. **Oude versie uitzetten.** Eerst wordt het actieve tabblad onthouden.
   Dan volgen `deactivate()` en `api._cleanup()`. Een fout of time-out in
   `deactivate` stopt niets en komt als waarschuwing `DEACTIVATE_FAILED` in
   het resultaat. Het na-opruimen uit §4 volgt één keer aan het eind van de
   wissel.
8. **Nieuwe versie activeren** met een nieuwe `createPluginApi(id)`. De host
   wacht op `activate(api)` met `await`, met een time-out van 10 s.
   - Gooit `activate` of wordt de promise afgewezen, dan volgt §7.4. Een
     time-out is via MCP ook een fout (§7.4); via het paneel blijft de
     extensie actief met `ACTIVATION_SLOW` (§7.1).
   - Het manifest komt uit `plugin.json`. Een `manifest`-export van de
     module overschrijft het niet meer: heeft die een ander id, dan mislukt
     de activatie (`ACTIVATION_FAILED`).
9. **Bevestigen.** Na `extensie_bevestig` (tot drie pogingen) wordt het
   record bijgewerkt en het onthouden tabblad weer actief gemaakt. Lukt
   bevestigen niet, dan volgt §7.4 met `CONFIRM_FAILED`. Het resultaat wordt
   opgeslagen onder de idempotentiesleutel.

### 7.4 Terugrollen

Mislukt stap 8 of 9:

1. `_cleanup()` voor de half-geactiveerde nieuwe versie, zodat alles weg
   is wat zij al registreerde. Bij een time-out eerst haar `deactivate()`;
   bij `CONFIRM_FAILED` het gewone uitzetten (`deactivate` en `_cleanup`).
   Een registratie die zij daarna nog doet, van welke soort ook, weigert de
   API met `EXTENSION_INACTIVE` (§4).
2. `extensie_terugdraaien(transactie)` zet de vorige bestanden terug.
3. De vorige broncode (`bron` uit het record, in het geheugen) wordt
   opnieuw geïmporteerd en geactiveerd. Dat werkt los van de schijf.
4. Het resultaat is `ok: false` met code `ACTIVATION_FAILED`,
   `ACTIVATION_TIMEOUT` of `CONFIRM_FAILED`, `rolledBack: true` en
   `active: { version: <oud>, activated: true }`.

Was er geen vorige versie, dan blijft er niets achter: `active` is
`null`, ook niet op schijf en ook niet in de lijst. Bij de volgende start
wordt dus geen kapotte code geladen. Stond er wel een vorige versie op
schijf die niet draaide (eerder mislukt), dan komen haar bestanden terug en
blijft ze met status `failed` in de lijst staan.

Ook een `MODULE_LOAD_FAILED` bij installeren (stap 6) draait de transactie
terug; het resultaat heeft dan `rolledBack: true` en de draaiende versie in
`active`.

Mislukt het terugzetten op schijf, dan wordt de oude code toch weer in het
geheugen geactiveerd. Het resultaat krijgt code `ROLLBACK_FAILED` met
`diskState: 'inconsistent'`. Het journaal blijft staan, zodat het herstel
bij de volgende start (§7.6) het afmaakt.

### 7.5 Herladen

`app_reload_extension` en de herlaadknop van het paneel lopen langs
hetzelfde pad als stap 6 tot en met 9, met de schijfversie als nieuwe code:

1. `index.js` opnieuw lezen en importeren. Elke import is een nieuwe
   module-instantie, omdat Blob-URL's niet gecachet worden.
2. Het actieve tabblad onthouden.
3. Uitzetten en volledig opruimen.
4. Activeren.
5. Mislukt het, dan wordt de vorige broncode uit het geheugen weer
   geactiveerd. Uitkomst: `ACTIVATION_FAILED`, `rolledBack: true`.

Op schijf verandert niets, dus er is geen native transactie nodig. Was de
extensie niet geladen (status `failed` of `notLoaded`), dan is herladen een
gewone laadpoging en is er niets om naar terug te gaan. Een syntax- of
importfout geeft `MODULE_LOAD_FAILED`; de draaiende versie wordt dan niet
uitgezet.

### 7.6 Opstarten en herstel na een onderbreking

`initPlugins` roept `extensie_lijst({ herstel: true })` aan: eerst de
herstelstap (`herstel_in`). Een journaal in `.opds-transacties` van een
proces dat niet meer bestaat, is een transactie die nooit is bevestigd: de
app is gecrasht tussen de wissel en de bevestiging. Die wordt volgens haar
fase teruggedraaid (§7.2). Een installatie geldt pas als geslaagd na een
geslaagde activatie en bevestiging. Een journaal in de fase `bevestigd`
wordt alleen opgeruimd. Journalen van een proces dat nog leeft (een tweede
app-venster) slaat het herstel over (`skipped`), met hun tussenmap en
back-up.

Daarna verdwijnen achtergebleven `.opds-staging`-mappen en back-ups zonder
journaal, `.tmp`-journalen die ouder zijn dan een minuut en `.levend`-
bestanden van gestopte processen. `recovered` geeft
`{ rolledBack, confirmed, skipped, removed, problems }`. Pas dan laadt de
levenscyclus elke extensie uit de lijst. Mislukkingen worden in het record
bewaard, met status `failed` en een foutcode, in plaats van alleen in de
console te verschijnen. De eerste keer laden bij het opstarten neemt het
opslagslot niet (§7.7): er verdwijnt dan niets uit de registers, en een
trage `activate` houdt opslaan zo niet op.

### 7.7 Open tabbladen en niet-opgeslagen wijzigingen

Garanties, afgedwongen door de opbouw van de code en bewaakt met tests:

- De levenscyclus roept nooit een tabblad-sluitfunctie aan, herlaadt de
  WebView niet (`location.reload`) en herstart de app niet. Ze schrijft
  niets in `state.documents`. `ui/chrome/tabs.js`, `relaunch` en
  `dialog.open` krijgt de module niet eens als afhankelijkheid mee.
- Annotaties van een extensietype blijven tijdens de wissel in
  `doc.annotations` staan. Ze worden alleen even niet getekend, en na de
  activatie weer wel. De vlag `modified` en de ongedaanmaakgeschiedenis
  blijven onaangeroerd.
- **Opslaan en een wissel sluiten elkaar uit.** De saver laat in-memory
  annotaties van een niet-geregistreerd type weg (`saver.js`, rond regel
  2726), en een bestaande verwijzing kan dan uit het bestand verdwijnen.
  Wachten aan het begin van `savePDF` was niet genoeg: de save liep daarna
  nog lang door (handtekeningvraag, `PDFDocument.load`, blob-fetch, de
  `serializeToPdf` van de extensie), en een wissel keek nooit naar een
  lopende save. Nu regelt `opslag-wissel-slot.js` het in beide richtingen:
  - `savePDF` draait `_savePDFNu` binnen `metOpslagSlot(fn)`, ná de
    handtekeningvraag. Die begint pas als er geen wissel loopt, en zet
    `_saveBezig` meteen, zodat een tweede save ook tijdens het wachten op
    de eerste wacht.
  - Elke wissel (bijwerken, herladen, terugrollen, uitzetten, verwijderen,
    een mislukte trage activatie opruimen) begint met `beginWisselSlot()`,
    en dat wacht tot alle lopende saves klaar zijn. Pas daarna verdwijnt er
    iets uit de registers.
  - Controleren en vastleggen gebeuren telkens in één synchroon stuk, dus
    er komt niets tussen "er loopt niets" en "nu loop ik".
  - De eerste keer laden bij het opstarten neemt het slot niet: er verdwijnt
    dan niets, en een trage `activate` houdt opslaan zo niet op.
  De saver en de levenscyclus importeren het slot allebei; de saver trekt
  zo de plug-in-laag niet mee. `wachtOpExtensieWissel()` bestaat nog voor
  wie alleen wil wachten.
- Een opdracht van de extensie die tijdens de wissel binnenkomt, krijgt
  `EXTENSION_BUSY` en wordt niet half uitgevoerd.

## 8. MCP-gereedschap

Alle drie lopen via `tool_app_request` naar de WebView. De handlers in
`mcp-bridge.js` zijn eenregelige doorverwijzingen naar
`extension-mcp.js`, met een luie import.

### 8.1 `app_list_extensions`

| | |
|---|---|
| Gebeurtenis | `mcp:list-extensions` |
| Time-out | 10 s |
| Meta | `lees("app_list_extensions", "List extensions")` |

```json
{
  "type": "object",
  "properties": {
    "includeContributions": { "type": "boolean", "description": "Also list each extension's registered contributions (ribbon tabs, command count, annotation types, palettes, property panels, and structured commands with their input and output schemas). Default false." }
  },
  "additionalProperties": false
}
```

Resultaat:

```json
{
  "ok": true,
  "count": 1,
  "extensions": [{
    "id": "nl.voorbeeld.kozijnen", "name": "Kozijnen", "version": "1.1.0",
    "installed": true, "installedVersion": "1.1.0", "loaded": true, "activated": true,
    "description": null, "author": null,
    "status": "active", "error": null, "source": "mcp", "installedVia": "mcp", "legacyId": false,
    "lastChange": { "action": "updated", "at": "2026-10-13T09:12:03Z", "source": "mcp" },
    "contributions": { "ribbonTabs": ["nl.voorbeeld.kozijnen.main"], "commands": 3,
                       "annotationTypes": [], "palettes": [], "propertyPanels": [],
                       "structuredCommands": [] }
  }],
  "problems": [{ "folder": "kapot", "code": "MANIFEST_INVALID", "error": "plugin.json is not valid JSON" }]
}
```

`contributions` verschijnt alleen bij `includeContributions: true` en komt
uit `api._bijdragenOverzicht()`. De lijst bevat zowel geïnstalleerde als
geladen extensies, dus ook geladen extensies die niet geïnstalleerd zijn
(`installed: false`) en geïnstalleerde die niet draaien. Ze is gesorteerd op
id. Voor de lijst haalt de handler eerst de native lijst opnieuw op
(`lijstVers`).

### 8.2 `app_install_extension`

| | |
|---|---|
| Gebeurtenis | `mcp:install-extension` |
| Time-out | 60 s |
| Meta | `wijzigt("app_install_extension", "Install extension")`, dus `destructiveHint: true`, omdat een bestaande installatie vervangen kan worden |

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "Absolute path to a local .oppx package. Relative paths, network shares and URLs are refused." },
    "replace": { "type": "string", "enum": ["never", "ifNewer", "always"], "description": "What to do when the extension id is already installed: 'never' refuses, 'ifNewer' replaces only a lower version, 'always' replaces (also a downgrade). An identical package (same SHA-256) is always reported as 'unchanged'." },
    "idempotencyKey": { "type": "string", "minLength": 8, "maxLength": 128, "pattern": "^[A-Za-z0-9._:-]+$", "description": "Caller-chosen key for this install request. Repeating a call with the same key, path and replace returns the stored result without installing again; the same key with a different path or replace is refused." }
  },
  "required": ["path", "replace", "idempotencyKey"],
  "additionalProperties": false
}
```

Alle drie de velden zijn verplicht, ook `replace`: het issue vraagt om een
expliciet vervangbeleid, dus er is geen standaardwaarde.

**Vervangbeleid.** Native toegepast. "Zelfde" betekent dezelfde SHA-256
als in `.opds-installatie.json`.

| `replace` | Niet geïnstalleerd | Zelfde pakket | Ander pakket |
|---|---|---|---|
| `never` | `installed` | `unchanged` | `ALREADY_INSTALLED` |
| `ifNewer` | `installed` | `unchanged` | nieuwe versie hoger: `updated`; gelijk of lager: `VERSION_NOT_NEWER`; een versie ontbreekt of is onleesbaar: `VERSION_UNCOMPARABLE` |
| `always` | `installed` | `unchanged` | `updated` (ook bij een lagere versie) |

- Versies worden vergeleken als `major.minor.patch[-pre]`, met
  semver-volgorde voor de prerelease-toevoeging. Een `+build`-toevoeging
  telt niet mee; voorloopnullen (`01.0.0`) maken een versie onleesbaar.
- Een oude installatie zonder `.opds-installatie.json` telt als een ander
  pakket.

**Idempotentie.**

- De sleutel geldt **per app-sessie**. Ze staat in het geheugen van de
  levenscyclus, met maximaal 200 sleutels (de oudste vervalt eerst) en een
  vervaltermijn van 24 uur.
- **Zelfde sleutel, zelfde `path` en `replace`, bewerking klaar:** het
  bewaarde resultaat komt terug met `replayed: true`. Er wordt niets
  opnieuw gedaan, ook niet als het bestand intussen is veranderd: zelfde
  sleutel betekent dezelfde bewerking.
- **Zelfde sleutel, bewerking loopt nog:** de tweede aanroep wacht op
  dezelfde promise en krijgt hetzelfde resultaat. Dat gebeurt
  bijvoorbeeld als een client na een time-out opnieuw probeert terwijl de
  eerste aanroep nog in de wachtrij stond.
- **Zelfde sleutel, ander `path` of `replace`:** `IDEMPOTENCY_KEY_REUSED`,
  en er gebeurt niets.
- Ook mislukte eindresultaten worden bewaard (bijvoorbeeld
  `ACTIVATION_FAILED`). Wie opnieuw wil proberen, gebruikt een nieuwe
  sleutel. Uitzondering: `INVALID_ARGUMENT` wordt niet bewaard, want er is
  niets gebeurd.
- **Over herstarts heen** is de sleutel weg. Dezelfde aanvraag levert dan
  via de hashvergelijking toch `outcome: 'unchanged'` op. Het eindresultaat
  is dus hetzelfde.
- De eerste aanroep krijgt `replayed: false`; elke herhaling (ook een die
  op een nog lopende bewerking wachtte) krijgt `replayed: true`. Een
  `IDEMPOTENCY_KEY_REUSED` wordt zelf niet bewaard.
- Installeren via het extensiepaneel maakt per keer een eigen sleutel
  (`ui-<tijd>-<willekeurig>`) met beleid `always` en bron `ui`.

**Resultaat bij succes:**

```json
{ "ok": true, "outcome": "updated", "id": "nl.voorbeeld.kozijnen", "name": "Kozijnen",
  "version": "1.1.0", "previousVersion": "1.0.0", "activated": true,
  "replayed": false, "rolledBack": false, "warnings": [],
  "contributions": { "ribbonTabs": ["nl.voorbeeld.kozijnen.main"], "commands": 3 } }
```

**Resultaat bij een fout:**

```json
{ "ok": false, "code": "ACTIVATION_FAILED", "error": "activate() threw: kapot",
  "id": "nl.voorbeeld.kozijnen", "version": "1.2.0", "activated": false,
  "rolledBack": true, "active": { "version": "1.1.0", "activated": true },
  "replayed": false }
```

Na een succesvolle installatie of bijwerking via MCP is de extensie direct
actief. Er is geen bestandsdialoog en geen herstart.

### 8.3 `app_reload_extension`

| | |
|---|---|
| Gebeurtenis | `mcp:reload-extension` |
| Time-out | 30 s |
| Meta | `voegt_toe("app_reload_extension", "Reload extension")`, dus niet alleen-lezen en niet destructief: er gaan geen gegevens verloren |

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "Extension id from app_list_extensions." }
  },
  "required": ["id"],
  "additionalProperties": false
}
```

Resultaat: `{ ok, outcome: 'reloaded', id, version, activated, rolledBack,
active, warnings, contributions }`. Bij een fout zijn `code` en `error`
gevuld, zoals hierboven.

Herladen is van nature herhaalbaar: twee keer herladen geeft dezelfde
eindtoestand. Een idempotentiesleutel is daarom niet nodig.

### 8.4 Foutcodes

| Code | Tool | Betekenis | Vorige versie |
|---|---|---|---|
| `INVALID_ARGUMENT` | alle | Een veld ontbreekt of is ongeldig. | onaangeroerd |
| `NOT_SUPPORTED` | alle | Geen Tauri-omgeving (webbouw). | n.v.t. |
| `PATH_NOT_ALLOWED` | install | Niet absoluut, apparaatpad, URL of geen `.oppx`; via MCP ook een netwerkshare (UNC, of een stationsletter of koppeling die naar een share wijst). | onaangeroerd |
| `FILE_NOT_FOUND` | install | Het bestand bestaat niet of is geen gewoon bestand. | onaangeroerd |
| `PACKAGE_INVALID` | install | Geen ZIP, te groot, te veel items, een onveilige naam, een symbolische koppeling, een gereserveerde naam of twee items die alleen in hoofdletters verschillen. | onaangeroerd |
| `MANIFEST_INVALID` | install, list | `plugin.json` ontbreekt, is geen JSON, heeft geen of een ongeldig `id`, of een ongeldige `version`. | onaangeroerd |
| `ENTRY_MISSING` | install | Geen `index.js` in de wortel. | onaangeroerd |
| `PACKAGE_CHANGED` | install | Het bestand is tussen controle en installatie veranderd. | onaangeroerd |
| `ALREADY_INSTALLED` | install | `replace: never` en een ander pakket staat er al. | onaangeroerd |
| `VERSION_NOT_NEWER` | install | `replace: ifNewer` en de nieuwe versie is niet hoger. | onaangeroerd |
| `VERSION_UNCOMPARABLE` | install | `replace: ifNewer` maar een versie ontbreekt of is onleesbaar. | onaangeroerd |
| `IDEMPOTENCY_KEY_REUSED` | install | Dezelfde sleutel met een ander `path` of `replace`. | onaangeroerd |
| `ID_CASE_CONFLICT` | install | Er staat al een extensie waarvan het id alleen in hoofdletters verschilt. Eerst die verwijderen. | onaangeroerd |
| `TRANSACTION_PENDING` | install | Een eerdere installatie van dit id is nog niet bevestigd (bijvoorbeeld in een ander app-venster). | onaangeroerd |
| `NOT_INSTALLED` | reload | Onbekend id. | n.v.t. |
| `INSTALL_IO_FAILED` | install | Een schijffout bij uitpakken of wisselen. Er is automatisch teruggezet. Ook een onverwachte fout in de levenscyclus wordt deze code. | blijft actief |
| `MODULE_LOAD_FAILED` | install, reload | Een syntax- of importfout in `index.js`. | blijft actief |
| `ACTIVATION_FAILED` | install, reload | `activate` gooide of de promise werd afgewezen. Ook een `INVALID_CONTRIBUTION` binnen `activate` valt hieronder; de oorspronkelijke code staat dan in `cause`. | teruggezet en actief |
| `ACTIVATION_TIMEOUT` | install, reload | `activate` was niet binnen 10 s klaar (alleen via MCP; §7.1). | teruggezet en actief |
| `CONFIRM_FAILED` | install | De installatie kon ook na drie pogingen niet op schijf bevestigd worden; daarom bewust teruggedraaid. | teruggezet en actief |
| `ROLLBACK_FAILED` | install | Terugzetten op schijf mislukte. De oude code draait wel weer in het geheugen (`diskState: 'inconsistent'`); het herstel bij de volgende start maakt het af. | actief in geheugen |

De codes komen uit `extension-mcp.js` en de native fouten worden
ongewijzigd doorgegeven. Een onbekende native fout wordt
`INSTALL_IO_FAILED`. Net als bij de andere app-tools staat de uitkomst in
`content[0].text` en blijft `isError` `false`. `ok: false` met `code` is de
foutmelding.

Waarschuwingen staan in `warnings` als `{ code, message }` en laten de
uitkomst `ok` ongemoeid: `DEACTIVATE_FAILED` (de oude `deactivate` gooide of
was na 5 s niet klaar), `CLEANUP_FAILED` (een opruimfunctie gooide),
`ACTIVATION_SLOW` (via het paneel of bij het opstarten: `activate` was na
10 s nog niet klaar, de extensie blijft actief; §7.1) en `RESTORE_FAILED`
(de vorige broncode kon bij het terugrollen niet opnieuw geïmporteerd
worden).

Intern gebruikt de native kant nog `TRANSACTION_UNKNOWN` (een onbekend of
ongeldig transactietoken); die code komt niet bij een MCP-client.

### 8.5 Aansluiting en samenvoegen met feat/567

Alles hieronder is toevoegen. Bestaande regels veranderen alleen waar
genoemd.

- **`mcp_server.rs`**
  - Een nieuwe helperfunctie `extensie_tools() -> Vec<Value>` met de drie
    definities, vlak boven `handle_tools_list`.
  - `handle_tools_list` bouwt de lijst nu in `let mut lijst = json!({ … });`
    en hangt er na `facade_element_tool()` de extensietools achter
    (`tools.extend(extensie_tools())`). Alleen de eerste regel en de staart
    van de functie veranderen.
  - Drie dispatch-armen vóór `other =>`.
  - De publieke telling in de test gaat van 62 naar 65; de drie namen
    staan in de lijst van de schematest, en de nieuwe test
    `extensies_zijn_te_beheren_via_mcp` controleert schema's en metadata.
  - Eén zin erbij in de beschrijving van `app_list_commands`.
- **`mcp_tool_meta.rs`**: drie regels.
- **`mcp-stdio/tools.json`**: de drie definities achteraan, in de volgorde
  van `handle_tools_list` (sleutels alfabetisch, met `annotations`), en de
  extra zin bij `app_list_commands`. Het kan met
  `OPDS_MCPB_TOOLS_SCHRIJVEN=1`, maar de Rust-libtests draaien lokaal niet
  (`STATUS_ENTRYPOINT_NOT_FOUND`). Daarom tekstueel bijgewerkt (bestaande
  getallen als `32.0` blijven zo staan), en daarna gecontroleerd met
  `brug.test.mjs`, `manifest.test.mjs` en `extensies-mcp-aansluiting.test.mjs`,
  dat de drie items in `tools.json` vergelijkt met de definities in
  `mcp_server.rs` en de metatabel.
- **`mcpb/manifest.json`**: opnieuw maken met
  `node mcpb/scripts/pack.mjs --manifest`.
- **`mcp-stdio/brug.test.mjs`**: de telling van 62 naar 65.
- **Samenvoegen.** Komt feat/567 eerst binnen, dan tellen beide
  tellingen beide toevoegingen op. Het staartje van `tools.json` en
  `manifest.json` wordt samengevoegd in de volgorde van
  `handle_tools_list`. Voegt feat/567 ook iets toe na
  `facade_element_tool()`, dan botst dat met de staart van
  `handle_tools_list`; die regels gewoon allebei houden.

### 8.6 Lint en panelen ontdekken en nalezen (#584)

Een agent moet de bediening van een geladen extensie kunnen vinden,
uitvoeren en controleren zonder schermautomatisering.

- **Tabbladen als opdracht.** `app_list_commands` zet elk linttabblad
  vooraan als `ribbon-tab:<tab>` (`kind: 'tab'`, `extension` bij een
  geregistreerd tabblad), ook de tabbladen van extensies. `app_run_command`
  activeert zo'n tabblad.
- **Tabbladen uit de DOM, niet uit een vaste lijst.** Zoeken, opsommen en
  uitvoeren lopen alle tabknoppen `.ribbon-tab` langs (zonder Bestand): eerst
  de ingebouwde in vaste volgorde, dan de rest in DOM-volgorde. Een tabknop
  heet naar zijn `data-tab`, of `#<id>` zonder. Geregistreerde
  extensietabbladen (§5) leveren hun knoppen als `ext:`-opdracht uit het
  register, met het tab-id in `tab`; een tabblad dat een extensie zelf in de
  DOM zette, levert de zichtbare knoppen van zijn zichtbare inhoud als
  `ribbon:#<id>` of `ribbon:<tab>:<n>`. De nummering van ingebouwde knoppen
  verandert niet.
- **`activatedTab`.** `app_click_element` meldt het tabblad dat de aanroep
  activeerde: van de knop zelf als een tabknop is aangeklikt (ook een
  extensietabblad), anders het tabblad waar de klik naartoe wisselde, anders
  dat wat het zoeken opende. `activeTab` is het actieve tabblad daarna.
- **`app_read_ui`.** Leest een compacte toegankelijkheidsboom: rol, naam en
  alleen de staat die geldt (`disabled`, `checked`, `pressed`, `selected`,
  `expanded`, `active`, `focused`, `readonly`, `hidden`), met `value` en
  `valueText` voor velden. Lintknoppen en keuzes dragen hun `command`.
  Zonder selector: lint, zijpanelen, balken boven het document, zwevende
  paletten, open dialogen en statusbalk; met een selector de elementen die hij
  aanwijst. Grenzen `maxDepth`, `maxNodes` en `maxText`; `truncated` meldt
  wat wegviel. Alleen lezen: geen tabwissel.

De regels staan in zuivere modules met eenheidstests:
`js/core/mcp-lint-opdrachten.js` (id's, volgorde, `activatedTab`) en
`js/core/mcp-ui-boom.js` (de boom). De brug doet alleen de DOM.

## 9. Beveiliging

- **Vertrouwensmodel.** De MCP-server draait alleen als de gebruiker de
  AI-koppeling aanzet, luistert alleen op `127.0.0.1` en weigert een
  niet-lokale `Host` of `Origin` (`verzoek_toegestaan`). Een client die
  daar binnenkomt, kan nu al elke knop bedienen. Een extensie installeren
  breidt dat uit tot **eigen code in de WebView, met dezelfde rechten als
  de app**, inclusief `invoke`. Dat is hetzelfde vertrouwen als een
  extensie die de gebruiker zelf via het paneel installeert. De tools staan
  daarom in het publieke profiel, zoals het issue vraagt, maar met
  `destructiveHint` op installeren, zodat MCP-clients om bevestiging
  vragen.
- **Geen omweg om de dialoog heen** die buiten dat model valt:
  - Alleen een expliciet, absoluut, lokaal `.oppx`-pad.
  - Geen URL's, geen downloads en geen netwerkshares: niet via UNC, en ook
    niet via een stationsletter of koppeling die naar een share wijst
    (na `canonicalize` een `\\?\UNC\…`-pad). Op Linux en macOS is een
    gekoppelde netwerkmap niet van een lokale map te onderscheiden; dat
    valt binnen het lokale vertrouwensmodel.
  - Geen zoekpatronen en geen "installeer alles in deze map".
  - Deze regels gelden voor MCP. De bestandsdialoog van het paneel mag, net
    als vóór deze issues, een pakket op een share kiezen: dat kiest de
    gebruiker zelf.
- **Validatie vóór schrijven.** Pakketcontrole op de bytes in het geheugen
  met een hashvergelijking tegen wijzigen tussendoor, een strikte id-regex
  en ZIP-limieten. Onveilige itemnamen keuren het pakket af in plaats van
  stil overgeslagen te worden.
- **Strikte id's ook in de bestaande commando's.** Daarmee is het
  wissen van de hele pluginmap via een id `""` of `.` niet meer mogelijk.
  Ook ontsnappen via `C:` kan niet meer.
- **Zichtbaar voor de gebruiker.** Het extensiepaneel toont bij een
  extensie die via MCP is geïnstalleerd of bijgewerkt het label "Via de
  AI-koppeling" (`extensionsPanel.viaMcp`), en de gebruiker kan haar daar
  verwijderen. Ook mislukte extensies staan in de lijst.
- **Geen DOM voor extensies in het lint.** Alleen gevalideerde data; de
  host tekent. SVG wordt geparseerd, getoetst aan een kleine subset en
  opnieuw uitgeschreven. Er komen geen ruwe strings van de extensie in
  `innerHTML`.
- **Geen geheimen.** De tools sturen geen padinformatie van de gebruiker
  terug, behalve het opgegeven pad in foutmeldingen.

## 10. Extensiepaneel en talen

- `ExtensionsPanel.jsx` gebruikt `levenscyclus.lijstVers()`, zodat ook
  mislukte en niet-geladen extensies zichtbaar zijn en verwijderd kunnen
  worden. Het paneel meldt zich aan met `levenscyclus.abonneer()`, zodat
  een installatie via MCP ook zichtbaar wordt terwijl het paneel open
  staat. Een extensie die niet actief is, krijgt een regel
  `extensionsPanel.activationFailed` met code en melding.
- Installeren via de dialoog loopt via `installPluginFromFile`, dus
  `installeer({ beleid: 'always', bron: 'ui' })` met een automatisch
  gemaakte sleutel. De bekende fout waarbij de oude code bleef draaien,
  verdwijnt daarmee. Een activatiefout wordt nu ook als fout getoond, met
  de foutcode.
- "Herladen" blijft "opnieuw installeren uit een bestand" via de dialoog,
  zoals nu, maar met terugrollen (`reinstallPlugin`). Dat werkt ook voor een
  extensie met een oud id: een pakket met precies dat id mag haar
  bijwerken (§7.2).
- Verwijderen loopt via `levenscyclus.verwijder(id)`: uitzetten, opruimen
  en van schijf halen in één bewerking in de wachtrij.
- Nieuwe sleutels, in **alle 39 localemappen** van `js/i18n/locales/`
  (Engelse bron, Nederlandse vertaling, overige talen vertaald):

  | Naamruimte | Sleutel | Engels |
  |---|---|---|
  | `appMenu` | `extensionsPanel.activationFailed` | `Not active: {{error}}` |
  | `appMenu` | `extensionsPanel.viaMcp` | `Via the AI connection` |
  | `ribbon` | `common.moreTabs` | `More tabs` |
  | `ribbon` | `common.extensionTabFailed` | `This extension tab could not be displayed.` |

  De bestaande `extensionsPanel.*`-sleutels staan alleen in `en` en `nl`.
  Dat ontbrekende stuk valt buiten deze issues. In de andere 37 talen komt
  daarom een nieuw `extensionsPanel`-object met alleen de twee nieuwe
  sleutels; de overige sleutels vallen zoals voorheen terug op `en`.
  De sleutels zijn tekstueel toegevoegd, zodat volgorde en regeleinden
  (CRLF) van de bestanden blijven.

## 11. Testplan

Testgestuurd: eerst de test, dan de code. Elke nieuwe test staat in
`open-pdf-studio/scripts/unit-testlijst.txt`. Alles moet op Node 20
draaien: geen `.ts`-imports zonder `app-test-hooks.mjs`, en geen
`zlib.crc32`.

### 11.1 Eenheidstests (`node:test`)

| Testbestand | Dekt |
|---|---|
| `js/plugins/extension-contributions.test.mjs` | Opruimen in omgekeerde volgorde. Een fout in één opruimfunctie stopt de rest niet. Dubbel opruimen. `voegToe` na opruimen geeft `EXTENSION_INACTIVE`. `CONTRIBUTION_CONFLICT` tussen twee extensies. Unload van A laat de bijdrage van B staan. |
| `js/plugins/svg-pictogram.test.mjs` | Een geldig 24×24-pictogram wordt identiek herschreven. Geweigerd: `script`, `foreignObject`, `on*`, `href`, `style`, `url(...)`, entiteiten, commentaar, tekst, een ontbrekende `viewBox`, meer dan 8 KB en meer dan 200 elementen. `{ builtin }` werkt, een onbekende naam niet. |
| `js/plugins/ribbon-tab-registry.test.mjs` | Lokaal en volledig id. Een vreemd voorvoegsel. Dubbele tab- en item-id's. Limieten. Taalkeuze van `label`. Het weergavemodel (groepen, stapelen van small/medium, dropdown, status). `update()` met validatie. `dispose()` haalt het tabblad weg en zet een actief tabblad op `home`. Opnieuw registreren na dispose geeft precies één tabblad. Sortering op extensie-id en `order`. |
| `js/solid/components/ribbon/ribbon-toetsenbord.test.mjs` | `volgendeTab` voor links, rechts, Home en End, met omloop en RTL-spiegeling. `verdeelTabbladen`: het actieve tabblad blijft zichtbaar en de overloop gaat naar het menu. |
| `js/plugins/extension-commands.test.mjs` | Opdracht-id's voor actie en keuze. De vorm van de lijst. Uitvoeren met `source: 'mcp'`. `COMMAND_DISABLED`, `COMMAND_BUSY`, `COMMAND_TIMEOUT`, `COMMAND_FAILED`, `UNKNOWN_COMMAND`, `EXTENSION_BUSY`. Een keuze zet de waarde pas na geslaagde `onChange`. Een opdracht verdwijnt bij dispose. |
| `js/plugins/extension-lifecycle.test.mjs` | Met een nep-`invoke`, nep-import en een nepstaat met twee documenten, waarvan één `modified: true`. Gedekt: nieuwe installatie; bijwerken; `unchanged`; elk vervangbeleid; idempotentie (herhalen, samenvoegen van gelijktijdige aanroepen, `IDEMPOTENCY_KEY_REUSED`, geen opslag van `INVALID_ARGUMENT`); `MODULE_LOAD_FAILED` laat de oude versie onaangeroerd; `activate` gooit, wijst af of verloopt, gevolgd door terugrollen met de oude versie actief en de nieuwe bijdragen weg; eerste installatie mislukt en laat niets achter; `ROLLBACK_FAILED`; herladen gelukt en mislukt; het actieve tabblad wordt hersteld; na-opruimen (gereedschap, hertekenen, paneel); `wachtOpExtensieWissel`; de wachtrij serialiseert; de documenten blijven hetzelfde object met dezelfde `modified` en hetzelfde aantal annotaties; sluit-, herlaad- en dialoogfuncties worden nooit aangeroepen. |
| `js/plugins/extension-mcp.test.mjs` | Invoercontrole voor de drie tools (verplichte velden, enum, sleutelpatroon, extra velden). De resultaatvorm bij succes en bij elke foutcode. `NOT_SUPPORTED` zonder Tauri. |
| `js/plugins/extensies-mcp-aansluiting.test.mjs` | Naar het voorbeeld van `annotatie-lagen-mcp.test.mjs`: de drie tools staan in `mcp-bridge.js`, `mcp_server.rs`, `mcp_tool_meta.rs`, `tools.json` en `manifest.json`. `handleRunCommand` heeft de `ext:`-tak. De knopselector sluit `data-ext-command` uit. `Ribbon.jsx` heeft het extensietabblad met `ErrorBoundary`. De vier i18n-sleutels staan in alle 39 localemappen. De nieuwe CSS-regels bevatten geen hard gecodeerde kleuren. |
| `js/plugins/oppx-testpakket.test.mjs` | De testhulp zelf: CRC32 volgens de standaard, een ZIP met bestanden en een map is terug te lezen, een `.oppx` met `plugin.json` en `index.js` in de wortel. |
| `js/plugins/opslag-wissel-slot.test.mjs` | Het slot zelf (save wacht op een wissel, wissel wacht op alle saves, ook een mislukte), en met de echte levenscyclus en het echte annotatietyperegister: een mislukte update midden in een save laat het type geen moment weg, en een save die tijdens het terugrollen begint, wacht tot het einde. |
| `js/plugins/plugin-api-opruimen.test.mjs` | Met de echte `createPluginApi` (`plugin-api-stubs.mjs`): na `_cleanup` weigert elke `register*` met `EXTENSION_INACTIVE`; een oude API haalt na herladen niets van de nieuwe weg; paneel en gereedschapsgroepen per extensie; installeren, herladen en uitzetten via de echte levenscyclus laten geen tabblad, geen `ext:`-opdracht en geen palet achter; een `activate` na de tijdgrens (MCP) registreert niets meer. |
| `js/tools/pijl-in-tabstrook.test.mjs` | Met het echte `keyboard-handlers.js` (`keyboard-handlers-stubs.mjs`): een pijltoets in de tabstrook, een menu of een keuzelijst, of een al afgehandelde pijltoets, verschuift geen annotatie, maakt geen ongedaan-stap en bladert niet; buiten zo'n element verschuift hij wel. |
| Bestaand: `mcp-stdio/brug.test.mjs`, `mcpb/manifest.test.mjs` | De telling 65 en dezelfde namen in dezelfde volgorde. |
| Bestaand, uitgebreid: `js/pdf/save-document.test.mjs` | De testopzet kent `metOpslagSlot`; nieuwe tests tonen dat `savePDF` niets leest of schrijft zolang een extensiewissel loopt, dat het slot na de handtekeningvraag komt en de hele schrijfactie duurt, en dat een tweede save op de eerste wacht. |

De testhulp `oppx-testpakket.mjs` maakt de synthetische pakketten bij het
draaien van de test. Er komen geen binaire bestanden in git.

**Uitkomst.** `npm run test:unit`: 3077 tests, 3073 geslaagd, 0 mislukt, 4
overgeslagen (dezelfde 4 als op main; main had 2962 tests). De nieuwe
testbestanden van #550/#551 hebben samen 112 tests; daarnaast heeft
`save-document.test.mjs` er drie voor #550. `npx vite build` slaagt.

### 11.2 Rust

Eenheidstests in `extensie_installatie.rs`, met een tijdelijke map:

- id-regex: `""`, `.`, `..`, `C:`, `C:x`, `a/b`, `con`, `con.x` en `A`
  worden geweigerd; `a`, `nl.voorbeeld.kozijnen` en `a-b.c1` worden
  geaccepteerd;
- padregels;
- ZIP-slip en symbolische koppelingen;
- ontbrekend `plugin.json` en ontbrekend `index.js`;
- limieten;
- de beleidstabel uit §8.2;
- de versievergelijking;
- wissel met bevestigen en met terugdraaien, ook bij een eerste
  installatie;
- herstel van een onbevestigd journaal, in alle fasen, plus het
  opruimen van wees-tussenmappen en wees-back-ups;
- de lijst met kapotte mappen als `problems` en oude id's als
  `legacyId: true`;
- netwerkpaden: UNC alleen via de dialoog, apparaatpaden nooit, en een
  `\\?\UNC\…`-pad na `canonicalize` via MCP geweigerd;
- twee items die alleen in hoofdletters verschillen (`plugin.json` en
  `PLUGIN.JSON`, `index.js` en `INDEX.JS`, `lib/a.js` en `LIB/A.js`),
  ook over een werkende installatie heen;
- een id in andere hoofdletters (`ID_CASE_CONFLICT`) en het bijwerken van
  een installatie met een oud id;
- bevestigen legt eerst vast, en het herstel draait een bevestigd journaal
  niet terug; een vergrendeld journaal laat de transactie open;
- een open transactie voor hetzelfde id (`TRANSACTION_PENDING`, en
  terugdraaien als de eigenaar weg is);
- het herstel slaat een levend proces over (ook nagebootst met een
  vastgehouden `.levend`-bestand) en laat de tussenmap tijdens het uitpakken
  staan;
- een al verplaatste back-up in de fase `voorbereid` komt terug, en een
  halve eerste installatie in de fase `oud-weg` verdwijnt;
- mislukt terugzetten laat journaal en back-up staan;
- alleen oude `.tmp`-journalen worden opgeruimd.

In `mcp_server.rs` komt de test `extensies_zijn_te_beheren_via_mcp` erbij
(schema's, metadata, de zin bij `app_list_commands`).

De lib-tests draaien lokaal niet (de testexe stopt met
`STATUS_ENTRYPOINT_NOT_FOUND`, `0xC0000139`) en CI draait geen
Rust-tests. Daarom:

```
cargo test --no-run
cargo build
```

in `open-pdf-studio/src-tauri`, met `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`,
`RUSTFLAGS="-C target-feature=-crt-static"` en de eigen
`CARGO_TARGET_DIR` van deze werkmap. Beide slagen.

Om de eenheidstests van `extensie_installatie.rs` toch te draaien, staan ze
ook in een kleine, losse testcrate buiten de repo (een kopie van het bestand
zonder de `#[tauri::command]`-regels, met een stub voor `datamap`, dezelfde
`Cargo.lock` en dezelfde target-map). Daar slagen alle 22 tests. Daarnaast
is alleen-lezend gecontroleerd dat een bestand op een netwerkschijf met
stationsletter na `canonicalize` een `\\?\UNC\…`-pad is en door
`is_netwerkpad` herkend wordt. De native werking wordt daarnaast live
gecontroleerd (11.3).

### 11.3 Live controle (`scripts/verify-extensies.mjs`)

Tegen een eigen testrig met `--mcp-server` op een vrije poort, nooit de
poort van de app van de gebruiker; het script weigert de bekende poorten
(9223/9233, 9235/9345, 9237/9347, 9238/9348) en heeft geen standaardpoort
(`MCP_PORT` en `CDP_PORT` zijn verplicht; CDP alleen om bij stap 9 de
bevestigingsvraag van het paneel met "ja" te beantwoorden, want een native
dialoog is via MCP niet te bedienen). `OPDS_DETACHED=1` staat aan, en `OPDS_DATA_DIR`
wijst naar een tijdelijke map, zodat de echte pluginmap van de gebruiker
onaangeroerd blijft; ook `WEBVIEW2_USER_DATA_FOLDER` is eigen. Met
`OPDS_HEADLESS=1` blijft het rigvenster buiten beeld en zonder focus; een
native dialoog wordt dan geweigerd (een `ask` geeft "nee"), dus het nabootsen
van de bevestigingsvraag in stap 9 blijft nodig.

```
node scripts/verify-extensies.mjs --pakketten <map>
MCP_PORT=<poort> CDP_PORT=<poort> node scripts/verify-extensies.mjs --map <map> [--data <OPDS_DATA_DIR>]
```

Het script maakt vijf pakketten (`nl.voorbeeld.kozijnen-<versie>.oppx`):

| Versie | Inhoud |
|---|---|
| `1.0.0` | Eén tabblad met een SVG-actie, een keuzelijst en een status, plus één zichtbaar gedokt palet (klasse `kozijnen-palet`, zodat de DOM het kan tellen). |
| `1.1.0` | Hetzelfde, met een ander label. |
| `1.2.0` | `activate` registreert een tabblad en gooit dan. |
| `1.3.0` | `activate` wijst asynchroon af. |
| `zipslip` | Een geldig pakket met daarnaast het item `../buiten.txt`. |

Stappen:

1. Open twee PDF-tabbladen (twee nieuwe, blanco PDF's via
   `app_new_blank_pdf`, zodat het script geen bestanden van buiten nodig
   heeft). Maak er één gewijzigd zonder opslaan (`app_create_annotation`).
   Leg `app_list_tabs` vast (namen, `modified`, aantal annotaties), en
   noteer de PID van het rigproces (uit `netstat` op de MCP-poort).
2. `app_install_extension(1.0.0, never, k1)`: verwacht `installed` en
   `activated`. `app_list_extensions` toont `active`. Dezelfde aanroep
   met `k1` geeft `replayed: true`. `k1` met `always` geeft
   `IDEMPOTENCY_KEY_REUSED`.
3. `app_list_commands` met filter `ext:` toont de actie en de twee keuzes.
   `app_run_command` voert de actie uit en zet de keuze. Het resultaat en
   de status in het lint kloppen.
4. Wissel via `app_click_element` naar de tabbladen `home` en `view` en
   terug naar het extensietabblad. Klap het lint in: `app_run_command`
   werkt nog. Klap het weer uit.
5. `app_install_extension(1.1.0, ifNewer, k2)`: verwacht `updated` en het
   nieuwe label. `1.0.0` met `ifNewer` geeft `VERSION_NOT_NEWER`.
6. `app_reload_extension`: verwacht `reloaded`. Er staat precies één
   `.ribbon-tab[data-tab^="nl.voorbeeld."]`, één palet in de bijdragen en
   precies één `.tp-ext.kozijnen-palet` in de DOM, en het extensietabblad is
   nog actief.
7. `1.2.0` en `1.3.0` met `always`: verwacht `ACTIVATION_FAILED`,
   `rolledBack: true` en `active.version` `1.1.0`. Het tabblad en de
   opdrachten van 1.1.0 werken nog. Op schijf staat 1.1.0.
8. Een pakket met ZIP-slip en een relatief pad: `PACKAGE_INVALID` en
   `PATH_NOT_ALLOWED`. De installatie blijft ongewijzigd.
9. Verwijderen via het extensiepaneel: de bevestigingsvraag wordt via CDP
   met "ja" beantwoord, `#ribbon-extensions` opent het paneel en
   `.ext-uninstall-btn` van de extensie wordt geklikt. Daarna is het
   extensietabblad weg, toont `app_list_commands` geen
   `ext:nl.voorbeeld.kozijnen:`-opdrachten meer, staat het palet niet meer
   in de DOM (dus niet meer in het globale register), kent
   `app_list_extensions` de extensie niet meer en is de map van schijf.
10. Tot slot zijn `app_list_tabs` en het aantal annotaties gelijk aan stap 1,
   het gewijzigde document staat nog op `modified: true` en de PID is
   dezelfde.

De DOM-controles (precies één tabblad, actief tabblad, status, ingeklapt)
gaan via `app_ui_state`, dat alleen in het ontwikkelprofiel van de rig
bestaat.

Daarnaast moet de gebruiker zelf bevestigen dat de toetsenbordbediening
werkt (pijltjes, Home, End, Tab de groep in), en dat de overloop werkt bij
een smal venster (extensiegroep in "Meer", extensietabbladen achter »).
Synthetische invoer in de rig is daarvoor niet betrouwbaar.

Vóór het committen draaien `npm run test:unit` en `npx vite build` in
`open-pdf-studio`.

**Uitkomst van de live controle.** Gedraaid tegen een debugbouw van deze
tak (frontend ingebakken met `tauri/custom-protocol`), met een eigen
`OPDS_DATA_DIR` en `WEBVIEW2_USER_DATA_FOLDER`, `--mcp-server --mcp-port
9261` en CDP op 9371: alle 38 controles van de toenmalige stappen 1 tot en
met 9 GOED, twee keer achter elkaar (de tweede keer na een herbouw, in een
verse datamap). Het rigproces bleef hetzelfde (zelfde PID) en de twee
PDF-tabbladen hielden hun `modified`-vlag en aantal annotaties. De nieuwe
stap 9 (verwijderen) en de DOM-telling van het palet uit §15 zijn nog niet
live gedraaid.

Aanvullend via CDP, ter controle en niet als vervanging van de bevestiging
door de gebruiker:

- `role`/`aria` en de rondgaande `tabindex` staan zoals in §5.8; het
  statusitem heeft `role="status"` en de tint `success` kreeg de kleur van
  `.measure-status-success`.
- Pijl links/rechts, Home en End wisselden het actieve tabblad en de focus,
  met omloop.
- In een venster van 700 px breed staat het extensietabblad achter de
  »-knop zolang "Start" actief is; het menu toont het, kiezen maakt het
  actief en zichtbaar, en terug naar 1200 px staat alles weer in de strook.
- Schermafdrukken van het extensietabblad in het donkere en het lichte
  thema: de bestaande lintklassen en themakleuren, geen eigen kleuren.

Bij die controle viel één fout op die daarna is opgelost: de »-knop bleef
staan terwijl alles paste, omdat de meting de tussenruimte maar aan één
kant meetelde. De verdeling meet nu knoppen en beschikbare ruimte op
dezelfde manier (§5.7).

### 11.4 Acceptatiecontroles

**#550**

| Eis uit het issue | Gedekt door |
|---|---|
| `app_list_extensions` met geïnstalleerde en geladen id's, versies en activatiestatus | §8.1; `extension-lifecycle.test.mjs` (lijst, ook mislukte); `extension-mcp.test.mjs`; live stap 2 en 7 |
| `app_install_extension` met een expliciet lokaal pad, expliciet vervangbeleid en idempotentiesleutel; eerst native installatie, dan activatie | §7.2 en §7.3, §8.2; Rust-tests (pad, beleid); `extension-mcp.test.mjs` (verplichte velden); `extension-lifecycle.test.mjs` (beleid, idempotentie, volgorde); live stap 2 en 5 |
| `app_reload_extension` deactiveert gecontroleerd, laadt opnieuw en ruimt de bijdragen op | §7.5, §4; `extension-contributions.test.mjs`; `extension-lifecycle.test.mjs` (herladen, na-opruimen); live stap 6 |
| Gestructureerde status met id, versie, `activated` en een foutcode bij ongeldige pakketten of activatiefouten | §8.2 tot en met §8.4; `extension-mcp.test.mjs` (elke code); Rust (`PACKAGE_INVALID`, `MANIFEST_INVALID`, `ENTRY_MISSING`); live stap 7 en 8 |
| Bij een fout blijft de vorige werkende installatie beschikbaar | §7.4; Rust (wissel en terugdraaien, journaalherstel); `extension-lifecycle.test.mjs` (terugrollen); live stap 7 en 8 |
| Geen bestandsdialoog, geen appherstart | §7.7; `extension-lifecycle.test.mjs` (dialoog, sluiten en herladen nooit aangeroepen); live stap 10 (zelfde PID) |
| Minimaal synthetisch pakket installeren via MCP | live stap 2 |
| Bijwerken en herladen | live stap 5 en 6 |
| Fout in `activate` afhandelen | `extension-lifecycle.test.mjs`; live stap 7 |
| Twee open PDF-tabbladen behouden, inclusief een document met niet-opgeslagen wijzigingen | §7.7; `extension-lifecycle.test.mjs` (nepstaat); `opslag-wissel-slot.test.mjs` en `save-document.test.mjs` (opslaan tijdens een wissel); live stap 1 en 10 |

**#551**

| Eis uit het issue | Gedekt door |
|---|---|
| `registerRibbonTab` met een namespaced id, label, pictogram en groepen | §5.1 tot en met §5.4; `ribbon-tab-registry.test.mjs`; `svg-pictogram.test.mjs` |
| Groepen met acties, keuzelijsten en status, met de bestaande themavariabelen, iconen en maten | §5.3 en §5.5; `ribbon-tab-registry.test.mjs` (weergavemodel); aansluitingstest (geen hard gecodeerde kleuren); live stap 3 plus een schermafdruk in een licht en een donker thema |
| Integratie met het actieve tabblad | §5.6; `ribbon-tab-registry.test.mjs` (terug naar `home`); live stap 4 en 6 |
| Inklappen | §5.6; live stap 4 |
| Horizontale overloop | §5.7; `ribbon-toetsenbord.test.mjs` (`verdeelTabbladen`); CDP-controle in een venster van 700 px (§11.3); bevestiging door de gebruiker in een smal venster staat nog open |
| Toetsenbordbediening | §5.8; `ribbon-toetsenbord.test.mjs`; CDP-controle (§11.3); bevestiging door de gebruiker staat nog open |
| Automatisch opruimen bij unload en herladen | §4; `extension-contributions.test.mjs`; `extension-lifecycle.test.mjs`; `plugin-api-opruimen.test.mjs` (echte API, late registraties, uitzetten); live stap 6, 7 en 9 |
| Opdracht-id's voor `app_list_commands` en `app_run_command` | §6; `extension-commands.test.mjs`; aansluitingstest (`ext:`-tak, selector); live stap 3 en 4 |
| Geen directe DOM-mutatie door extensies | §5.2 en §5.5 (alleen data, de host tekent); `svg-pictogram.test.mjs` |
| Eén tabblad met een SVG-actie en een keuzelijst; wisselen naar ingebouwde tabbladen en terug; inklappen; unload en reload; uitvoering via MCP zonder dubbele tabbladen of paletten | live stap 2 tot en met 9 (tellingen in stap 6, verwijderen in stap 9); `plugin-api-opruimen.test.mjs` |

## 12. Bouwvolgorde

Elke stap begint met de test. Alle acht stappen zijn uitgevoerd.

1. `extension-contributions.js` en `svg-pictogram.js`.
2. `ribbon-tab-registry.js` en `extension-commands.js`. Daarna de kleine
   toevoeging in `plugin-api.js`.
3. `Ribbon.jsx`, `RibbonTab.jsx`, `ExtensionRibbonTab.jsx`,
   `ribbon-toetsenbord.js` en de CSS.
4. `extensie_installatie.rs`, plus de strikte id-controle in de bestaande
   commando's. Controleren met `cargo test --no-run` en `cargo build`.
5. `extension-lifecycle.js`. `plugin-manager.js` wordt de laag erboven,
   en de `await` komt in `savePDF`.
6. `extension-mcp.js`, de handlers in `mcp-bridge.js` en de Rust-tools,
   meta, `tools.json`, het manifest en de tellingen.
7. `ExtensionsPanel.jsx` en de i18n-sleutels in alle 39 mappen.
8. `scripts/verify-extensies.mjs` live tegen de rig. Daarna
   `npm run test:unit` en `npx vite build`.

## 13. Buiten deze issues

- Eigenaarschap tussen extensies voor de bestaande bijdragesoorten
  (annotatietypen, paletten, eigenschappenpanelen): twee extensies die
  hetzelfde type of palet-id registreren, overschrijven elkaar nog. Het
  paneel en de gereedschapsgroepen worden wel al per extensie hersteld
  (§4). De scope uit §4 is daar al geschikt voor.
- ~~Een publieke `api.registerCommand` voor opdrachten zonder knop.~~
  Gebouwd voor #575 als gestructureerde opdracht met schema's (§16).
- Een `app_uninstall_extension`.
- Pakketten met meerdere bestanden: relatieve imports vanuit een Blob-URL
  werken niet, dus `index.js` blijft een enkele bundel.
- Sneltoetsen en Alt-toetstips in het lint.
- Ontbrekende vertalingen van de bestaande `extensionsPanel.*`-sleutels.
- Een handtekening of herkomstcontrole voor `.oppx`-pakketten.

## 14. Afwijkingen van het eerste ontwerp

Bij het bouwen bleek op deze punten een andere of preciezere keuze nodig.
Ze zijn hierboven al verwerkt; dit is het overzicht.

| Onderwerp | Eerste ontwerp | Gebouwd | Waarom |
|---|---|---|---|
| Na-opruimen (§4) | Na het opruimen | Eén keer per wissel, aan het eind, met de annotatietypen van de vorige versie; het gereedschap wordt alleen teruggezet als het een type van de extensie was | Geen onnodige wissel naar `select` bij een herlading, en geen tweede hertekening |
| Id's in bestaande commando's (§7.2) | Strikte id-controle in alle drie | Strikt in `install_plugin`; `read_plugin_file` en `uninstall_plugin` accepteren ook een veilig oud id | Anders laden bestaande installaties met een afwijkend id niet meer, terwijl het ontwerp zegt dat ze via de oude route blijven laden |
| Herstel bij het opstarten (§7.6) | Een herstelstap | `extensie_lijst({ herstel: true })` | Zo blijft het bij vijf commando's |
| Journaal (§7.2) | `{ id, fase, backup, aangemaakt }` | Vier fasen (`voorbereid`, `oud-weg`, `gewisseld`, `bevestigd`), plus `eigenaar` en `pid` | Het herstel moet weten of de oude installatie al verplaatst is, of de installatie al geldt, en of het proces nog leeft |
| `extensie_installeer` (§7.2) | `(pad, beleid, verwachteSha256)` | Plus `bron` (`ui` of `mcp`) | Voor `source` in `.opds-installatie.json` en het label in het paneel |
| SVG-attributen (§5.4) | Eén lijst voor alle elementen | Per element alleen de eigen attributen | Strenger, en een `d` op `svg` heeft geen betekenis |
| Keuzelijst en status (§5.3) | Losse rijen | Opeenvolgende rijen in één kolom van hooguit drie | Anders staan ze naast elkaar en lopen ze buiten de 94 px |
| Resultaat van een opdracht (§6) | `RESULT_TOO_LARGE` | Ook `RESULT_NOT_SERIALIZABLE` | Een kringverwijzing mag de MCP-aanroep niet breken |
| Lijst (§8.1) | — | Extra velden `installedVia`, `description`, `author` | Voor het paneel en het label "Via de AI-koppeling" |
| Opslaan tijdens een wissel (§7.7) | `wachtOpExtensieWissel` uit de levenscyclus | Wederzijds slot in `opslag-wissel-slot.js` | Eén keer wachten aan het begin was niet genoeg, en een wissel keek niet naar een lopende save |
| `handle_tools_list` (§8.5) | Helper aanhaken | `let mut lijst = json!(…)` plus `extend` | `json!` kan geen `Vec` uitpakken |
| Live controle (§11.3) | Twee geopende PDF's; script onder `open-pdf-studio/scripts/` | Twee nieuwe, blanco PDF's; script in `scripts/` van de repo-wortel; een vijfde pakket voor ZIP-slip | Geen externe bestanden nodig; naast de andere verify-scripts |
| `RibbonButton.jsx` | Niet genoemd | Twee optionele props en een pictogram dat de prop volgt | Nodig voor `data-ext-command`, `aria-pressed` en `update(..., { icon })` |

## 15. Herstelde gebreken na de review

| Gebrek | Oplossing | Test |
|---|---|---|
| Pijl links/rechts in de tabstrook verschoof ook de geselecteerde annotaties (met ongedaan-stap) | `keyboard-handlers.js` laat pijltoetsen in een tabstrook, menu of keuzelijst, en al afgehandelde pijltoetsen, liggen; de tabstrook negeert toetsen met een modificatietoets (§5.8) | `pijl-in-tabstrook.test.mjs`; aansluitingstest |
| Opslaan wachtte alleen bij de start op een wissel en een wissel nooit op een save: annotaties van een extensie konden uit het bestand verdwijnen | Wederzijds slot `opslag-wissel-slot.js`; het slot komt na de handtekeningvraag (§7.7) | `opslag-wissel-slot.test.mjs`; `save-document.test.mjs` |
| Late registraties na `_cleanup` (typen, paletten, panelen, luisteraars) bleven voorgoed staan; een oude API kon de bijdragen van de nieuwe versie weghalen; paneel en gereedschapsgroepen werden globaal hersteld | API gesloten na `_cleanup`, `unregister*` alleen voor eigen bijdragen, herstel per extensie (§4) | `plugin-api-opruimen.test.mjs` |
| De live controle had geen uitzetstap en de paletcontrole kon niet mislukken | Stap 9 verwijdert via het paneel en controleert tabblad, opdrachten en palet; het palet wordt in de DOM geteld (§11.3) | aansluitingstest; `plugin-api-opruimen.test.mjs` |
| Een netwerkschijf met stationsletter kwam via MCP door de padcontrole | Na `canonicalize` ook `\\?\UNC\…` weigeren (§7.2, §9) | Rust `netwerkpaden_alleen_via_de_dialoog`; alleen-lezend gecontroleerd op een echte netwerkschijf |
| `CONFIRM_FAILED` gaf `ok: true`, terwijl het herstel de update bij de volgende start stil terugdraaide (en een latere installatie mee) | Fase `bevestigd` vóór het opruimen; drie pogingen; anders bewust terug met `ok: false`; een nieuwe installatie over een open journaal geeft `TRANSACTION_PENDING` (§7.2) | Rust `bevestigen_legt_eerst_vast…`, `een_open_transactie_voor_hetzelfde_id`; `extension-lifecycle.test.mjs` |
| Het herstel van een tweede app-proces draaide de lopende installatie van het eerste terug | `eigenaar` en `pid` in het journaal, `.levend`-bestand op Windows; journaal vóór het uitpakken (§7.2, §7.6) | Rust `herstel_slaat_een_levend_proces_over` |
| Het herstel kon de vorige installatie wissen (fase `voorbereid` met verplaatste back-up; foutpaden wisten het journaal ook als terugzetten mislukte) | Back-up terugzetten in `voorbereid`; journaal alleen weg als terugzetten lukte (§7.2) | Rust `herstel_zet_een_al_verplaatste_backup_terug`, `mislukt_terugzetten_laat_het_journaal_staan` |
| Een oud id dat alleen in hoofdletters verschilt, werd op schijf vervangen terwijl de oude extensie bleef draaien | `ID_CASE_CONFLICT` (§7.2) | Rust `id_dat_alleen_in_hoofdletters_verschilt` |
| Dubbele ZIP-items die alleen in hoofdletters verschillen omzeilden de pakketcontrole | Uniek op kleine letters in controle en uitpakken, plus `create_new` (§7.2) | Rust `dubbele_items_die_alleen_in_hoofdletters_verschillen` |
| De omhulling `.ribbon-panel` brak bestaande extensies die de ingebouwde inhoud met een kindselector verbergen | Omhulling weg; `aria-controls` naar `#tab-<id>` (§5.8) | aansluitingstest |
| `activate` met een tijdgrens ook bij het opstarten: een trage extensie werd opgeruimd zonder `deactivate` en was daarna niet meer te herladen | Bij het opstarten en via het paneel `ACTIVATION_SLOW`; via MCP eerst `deactivate`, dan `_cleanup`; de eerste keer laden neemt het opslagslot niet (§7.1) | `extension-lifecycle.test.mjs` |
| Een extensie met een oud id was via het paneel niet meer bij te werken | Een oud id mag een bestaande installatie met precies dat id bijwerken (§7.2) | Rust `oud_id_bijwerken` |
| De dialoog weigerde pakketten op een netwerkshare | Bron mee naar de native kant; UNC alleen via MCP verboden (§7.2) | Rust `netwerkpaden_alleen_via_de_dialoog`; `extension-lifecycle.test.mjs` |
| De README van `mcp-stdio` noemde nog 62 tools | 65 | aansluitingstest |

## 16. Gestructureerde opdrachten van extensies (#575)

Een `ext:`-opdracht (§6) is een knop: zonder argumenten, en het resultaat
is wat de knop teruggeeft. Een agent die een dienst van een extensie wil
gebruiken, heeft meer nodig. Denk aan pagina's importeren in een nieuwe
tekening, koppelingen tussen pagina en bron beschrijven, een projectsysteem
toewijzen of hoeveelheidslabels verversen. Daarvoor zijn getypeerde
argumenten nodig, een gecontroleerd resultaat en een stabiel aanvraag-id.
Bij een wijziging is er ook bescherming nodig tegen dubbel uitvoeren en
tegen een verouderde toestand. Dit is de omgekeerde richting van #556: daar
geeft een extensie een taak aan de agent, hier roept de agent de extensie
aan. Dat gaat zonder DOM, zonder bestandsdialoog en zonder het
assistentgesprek.

### 16.1 Bestanden

| Bestand | Rol |
|---|---|
| `js/plugins/json-schema-subset.js` | Strikte deelverzameling van JSON Schema: schema controleren en normaliseren, waarde controleren, `local-path`. |
| `js/plugins/structured-commands.js` | Register en dispatcher (`gestructureerdeOpdrachten`), plus de MCP-handlers `handleCallExtensionCommand` en `handleCancelExtensionCommand`. Zuiver. |
| `js/plugins/plugin-api.js` | `registerCommand`, `unregisterCommand`, `runCommand`, `features.structuredCommands`, `getDocumentInfo().revision` en `structuredCommands` in `_bijdragenOverzicht()`. |
| `js/core/undo-manager.js` | `documentRevisie(doc)`: de inhoudsrevisie `d<n>`, die bij elke stap in de undo-geschiedenis ophoogt. |
| `js/mcp-bridge.js` | `mcp:call-extension-command`, `mcp:cancel-extension-command`, en de lijst naar Rust (`mcp_set_extension_tools`). |
| `src-tauri/src/mcp_extensie_tools.rs` | Bewaart en controleert de lijst uit de WebView; het Tauri-commando `mcp_set_extension_tools`. |
| `src-tauri/src/mcp_server.rs` | `tools/list` met de extensietools, de route voor `ext_`-namen, `app_call_extension_command` en `notifications/cancelled`. |
| `js/plugins/structured-commands.test.mjs` | Eenheidstests en de aansluiting op brug, Rust, `tools.json` en manifest. |

### 16.2 Registreren

```js
if (api.features?.structuredCommands) {
  const { tool } = api.registerCommand({
    name: 'assign_system',                       // a-z, 0-9, enkele '_'; hooguit 48 tekens
    title: { en: 'Assign project system', nl: 'Projectsysteem toewijzen' },
    description: 'Assign a technical project system to a linked ceiling.',
    effect: 'mutate',                            // 'read' (standaard) of 'mutate'
    timeoutMs: 30000,                            // 1000-120000, standaard 30000
    inputSchema: {
      type: 'object',
      properties: {
        annotationId: { type: 'string', minLength: 1 },
        systemId: { type: 'string', enum: ['p-600', 'p-625'] },
      },
      required: ['annotationId', 'systemId'],
    },
    outputSchema: {
      type: 'object',
      properties: { revision: { type: 'string' } },
      required: ['revision'],
    },
    async handler(args, ctx) {
      // Dezelfde dienstcode als de eigen bediening van de extensie.
      return dienst.wijsToe(args, { signal: ctx.signal });
    },
  });
  // tool === 'ext_nl_voorbeeld_plafond__assign_system'
}
```

- **Naamruimte.** De toolnaam is `ext_` + het extensie-id met `_` voor
  `.` + `__` + de naam. Een extensie-id bevat nooit `_`, dus de naam is
  terug te rekenen naar de extensie (`extensieUitTool`). Geen vaste tool
  begint met `ext_`, en een andere extensie kan dezelfde naam niet krijgen.
  De toolnaam is hooguit 64 tekens. Een langere naam geeft
  `INVALID_CONTRIBUTION`, met de vraag om een kortere naam.
- **Fouten bij registreren** (allemaal `ExtensionContributionError`):
  - `INVALID_CONTRIBUTION`: een onbekend veld, een ongeldige naam of
    tekst, een schema buiten de deelverzameling van §16.3, een
    invoerschema dat `idempotencyKey` of `revisionContext` definieert, of
    een open invoerschema bij `mutate`;
  - `CONTRIBUTION_CONFLICT`: de naam bestaat al;
  - `LIMIT_EXCEEDED`: meer dan 32 opdrachten;
  - `EXTENSION_INACTIVE`: na `_cleanup`.
- **Afmelden.** `api.unregisterCommand(name)` haalt alleen weg wat deze API
  registreerde. Een oude API raakt na herladen de opdracht van de nieuwe
  versie niet. Lopende aanroepen krijgen `COMMAND_UNREGISTERED`.
- **Zelf aanroepen.** `api.runCommand(name, args)` loopt langs precies
  dezelfde controles als MCP (`source: 'api'`). De eigen bediening en een
  agent nemen zo hetzelfde pad.
- **Overzicht.** `app_list_extensions` met `includeContributions` geeft per
  extensie `structuredCommands`: `{ tool, extension, name, title,
  description, effect, timeoutMs, inputSchema, outputSchema }`. Het
  invoerschema is het gepubliceerde schema (§16.4).

### 16.3 Schema's

Alleen de trefwoorden hieronder zijn toegestaan. Elk ander trefwoord
(`oneOf`, `anyOf`, `allOf`, `$ref`, `patternProperties`, `if`, …) geeft bij
het registreren `INVALID_CONTRIBUTION`. Zo belooft een schema nooit een
controle die de host niet doet.

| Soort | Trefwoorden |
|---|---|
| Algemeen | `type` (een of meer van `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`), `enum`, `const`, `title`, `description`, `default`, `examples` |
| Object | `properties`, `required` (moet in `properties` staan), `additionalProperties` (alleen `true` of `false`) |
| Lijst | `items` (één schema), `minItems`, `maxItems`, `uniqueItems` |
| Tekst | `minLength`, `maxLength` (in tekens), `pattern` (met de vlag `u`), `format: 'local-path'` (§16.8) |
| Getal | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` |

- Elk schema heeft `type`, `enum` of `const`. De wortel van het invoer- en
  het uitvoerschema is `type: 'object'`.
- **Afwijking van JSON Schema, met opzet:** een object-schema zonder
  `additionalProperties` krijgt `false`. Een onbekend veld wordt dus
  geweigerd, tenzij het schema `additionalProperties: true` zegt. Het
  gepubliceerde schema in `tools/list` noemt de `false` expliciet. Een
  client leest dus hetzelfde als wat de host controleert.
- Een wijzigende opdracht heeft een gesloten invoerschema. Een open schema
  zou een agent velden laten meegeven die niemand controleert.
- Grenzen: een schema is hooguit 64 KB en 16 niveaus diep, een `enum` heeft
  hooguit 256 waarden en een `pattern` hooguit 512 tekens.
- `default` is alleen beschrijving: de host vult niets in.

### 16.4 In `tools/list`

Na elke wijziging van het register stuurt de WebView de hele lijst naar
Rust (`invoke('mcp_set_extension_tools', { tools, seq })`, in een microtaak
samengevoegd). Rust controleert de vorm en vervangt de bewaarde lijst:

- een naam `ext_…` met `__`, hooguit 64 tekens en uniek;
- een beschrijving, een object-schema, een titel en de twee hints;
- samen hooguit 256 tools en 2 MB.

Een kapotte lijst wordt in zijn geheel geweigerd; de vorige blijft dan
staan. Het volgnummer `seq` is een tijdstempel in microseconden. Het loopt
dus ook na een herlading van de WebView door, en een trage, oudere lijst
zet niets terug.

`tools/list` geeft eerst de vaste gereedschappen van het profiel en
daarachter de extensietools:

```json
{ "name": "ext_nl_voorbeeld_plafond__assign_system",
  "description": "Assign a technical project system to a linked ceiling. (Extension nl.voorbeeld.plafond.)",
  "inputSchema": { "type": "object", "properties": { "annotationId": {…}, "systemId": {…},
                   "idempotencyKey": {…}, "revisionContext": {…} },
                   "required": ["annotationId", "systemId", "idempotencyKey", "revisionContext"],
                   "additionalProperties": false },
  "annotations": { "title": "Assign project system", "readOnlyHint": false,
                   "destructiveHint": true, "openWorldHint": false } }
```

- `readOnlyHint` is `true` bij `effect: 'read'` en `destructiveHint` is
  `true` bij `effect: 'mutate'`. Claude vraagt dus bij elke wijzigende
  opdracht om toestemming.
- Een `tools/call` met een `ext_`-naam die geen geladen extensie
  registreert, geeft een JSON-RPC-fout (`INVALID_PARAMS`). Een oude tool is
  na herladen of verwijderen dus meteen weg.
- De extensietools staan in beide profielen; ze zijn geen
  ontwikkelgereedschap.
- **Geen pushmelding.** De server is HTTP zonder stroom en kan geen
  `notifications/tools/list_changed` sturen (`listChanged: false`). Een
  client die zijn lijst las voordat de extensie geladen was, ziet de nieuwe
  tools pas na opnieuw verbinden. Daarom is er ook de vaste tool
  **`app_call_extension_command`** (`{ tool, arguments }`, meta
  `wijzigt`). Die doet dezelfde aanroep, met de opdracht als argument. De
  schema's staan in `app_list_extensions` met `includeContributions`. De
  vaste lijst komt daarmee op 72 publieke tools.
- `mcp-stdio/tools.json` en de manifest bevatten alleen de vaste tools. De
  stdio-brug stuurt `tools/list` door naar de app, dus een client via de
  brug ziet de extensietools ook.

### 16.5 Een aanroep

Rust stuurt `mcp:call-extension-command` met `{ tool, arguments, rpcId }`;
voor `app_call_extension_command` is dat `{ generic: true, call, rpcId }`.
Rust wacht 125 s. De WebView houdt zich aan de tijdgrens van de opdracht
(hooguit 120 s) en antwoordt dus altijd eerder. De dispatcher controleert
in deze volgorde, en de handler draait pas als alles klopt:

1. `EXTENSION_BUSY` als de extensie wordt geïnstalleerd of herladen. Dat
   geldt ook als de opdracht op dat moment even niet geregistreerd is.
2. `UNKNOWN_COMMAND`.
3. `arguments` is een JSON-object van hooguit 1 MB.
4. Bij een leesopdracht mogen `idempotencyKey` en `revisionContext` niet
   meekomen.
5. De argumenten (zonder die twee velden) tegen het invoerschema. Een fout
   geeft `INVALID_ARGUMENT` met `details: [{ path, message }]`
   (JSON-pointer, hooguit 20).
6. Bij `mutate`: `idempotencyKey` en `revisionContext` (§16.6), dan de
   idempotentie, dan de documentrevisie.
7. `COMMAND_BUSY` als er al 8 handlers van dezelfde opdracht lopen.

De handler krijgt een JSON-kloon van de argumenten en een bevroren `ctx`:
`{ requestId, tool, command, extensionId, source: 'mcp'|'api', signal,
idempotencyKey, revisionContext }`. Bij een leesopdracht zijn de laatste
twee `null`.

**Resultaat.** Altijd een object, nooit een afwijzing. Zoals bij de andere
app-tools staat het in `content[0].text` en blijft `isError` `false`:

```json
{ "ok": true, "requestId": "xc-mgq2k1o0-7", "tool": "ext_nl_voorbeeld_plafond__assign_system",
  "extension": "nl.voorbeeld.plafond", "command": "assign_system",
  "result": { "revision": "i1-0c4f…" }, "replayed": false }
```

- `requestId` is per aanroep uniek en staat in elk antwoord, ook bij een
  fout. De handler kent hetzelfde id (`ctx.requestId`). Een herhaling met
  dezelfde idempotentiesleutel geeft het antwoord van de oorspronkelijke
  aanvraag terug, met diens `requestId` en met `replayed: true`.
- Het resultaat moet een JSON-object zijn (anders `RESULT_INVALID`). Het is
  hooguit 256 KB (anders `RESULT_TOO_LARGE`) en past op het uitvoerschema
  (anders `RESULT_INVALID` met `details`).
- Gooit de handler een fout met een `code` van hoofdletters, cijfers en `_`
  (3-48 tekens), dan wordt dat de foutcode. Een voorbeeld is de eigen
  `STALE_REVISION` van een projectrevisie. `details` gaat mee als het JSON
  is en hooguit 16 KB. Een `AbortError` wordt `COMMAND_CANCELLED`; elke
  andere fout wordt `COMMAND_FAILED`.

| Code | Betekenis |
|---|---|
| `INVALID_ARGUMENT` | Argumenten, `idempotencyKey` of `revisionContext` ongeldig. De handler draaide niet. |
| `UNKNOWN_COMMAND` | Geen geladen extensie met deze opdracht. |
| `EXTENSION_BUSY` | De extensie wordt geïnstalleerd of herladen; probeer het later opnieuw. |
| `DOCUMENT_NOT_FOUND` | `revisionContext.documentId` is geen open document. |
| `STALE_REVISION` | De documentrevisie (of, vanuit de handler, een eigen revisie) is verouderd; zie `details.currentRevision`. |
| `IDEMPOTENCY_KEY_REUSED` | Dezelfde sleutel met andere argumenten of een andere context. |
| `COMMAND_BUSY` | Er lopen al 8 aanroepen van deze opdracht. |
| `COMMAND_TIMEOUT` | Niet binnen `timeoutMs` klaar. Het signaal is afgebroken; de handler kan nog afronden. |
| `COMMAND_CANCELLED` | Afgebroken door de client (`notifications/cancelled`), of de handler gaf een `AbortError`. |
| `EXTENSION_UNLOADED` | De extensie werd uitgezet of herladen terwijl de aanroep liep. |
| `COMMAND_UNREGISTERED` | De extensie meldde de opdracht af terwijl de aanroep liep. |
| `RESULT_INVALID`, `RESULT_TOO_LARGE` | Het resultaat past niet op het uitvoerschema of is te groot. |
| `COMMAND_FAILED` | De handler gooide een fout zonder eigen code. |

### 16.6 Wijzigende opdrachten: idempotentie en revisies

Het gepubliceerde invoerschema van een `mutate`-opdracht krijgt twee
verplichte velden van de host. Een extensie mag ze niet zelf definiëren.

**`idempotencyKey`**: 8-128 tekens uit `A-Z a-z 0-9 . _ : -`, gekozen door
de aanroeper. Per `(tool, sleutel)` geldt:

- Zelfde sleutel, zelfde argumenten en context, wijziging geslaagd: het
  bewaarde antwoord komt terug met `replayed: true` en de handler draait
  niet opnieuw. Zo maakt een herhaling geen tweede PDF of tweede
  annotatiebatch.
- Zelfde sleutel terwijl de eerste aanroep nog loopt (ook na een
  `COMMAND_TIMEOUT`): de tweede aanroep wacht op dezelfde uitkomst, met
  dezelfde tijdgrens.
- Zelfde sleutel, andere argumenten of context: `IDEMPOTENCY_KEY_REUSED`.
- Een mislukte wijziging wordt niet bewaard. Er is niets gebeurd, dus
  dezelfde sleutel mag opnieuw. Een `INVALID_ARGUMENT` komt niet eens tot
  de idempotentie.
- De sleutels gelden per app-sessie en staan in het geheugen: hooguit 500
  geslaagde antwoorden, 24 uur lang. Ze horen bij de toolnaam en blijven
  dus over een herlading van de extensie heen bestaan. Had de oude versie
  de wijziging al gedaan, dan krijgt een herhaling na herladen dat
  antwoord.
- De idempotentie komt vóór de revisiecontrole. Een herhaling na een
  geslaagde wijziging draagt de revisie van vóór die wijziging, en moet
  toch het bewaarde antwoord krijgen.

**`revisionContext`**: `{ documentId, documentRevision }`,
`{ sourceRevision }`, of alle drie (elk 1-128 tekens).

- `documentId` met `documentRevision` controleert de host zelf, vóór de
  handler. Het document moet open zijn (anders `DOCUMENT_NOT_FOUND`) en
  `documentRevisie(doc)` moet gelijk zijn (anders `STALE_REVISION` met
  `currentRevision`). De revisie is `d<n>` en verandert bij elke stap in de
  undo-geschiedenis, ook bij ongedaan maken en opnieuw. Een extensie leest
  hem met `api.getDocumentInfo().revision` en geeft hem in haar
  leesresultaten door aan de agent. De id's komen uit
  `getDocumentInfo().id` en `app_list_tabs`.
- `sourceRevision` is van de extensie zelf (een project- of bronrevisie).
  De host geeft hem door in `ctx.revisionContext`. De handler controleert
  hem en gooit bij een verouderde waarde een fout met
  `code: 'STALE_REVISION'`.

De dispatcher wijzigt zelf geen document en wisselt geen tabblad. Andere
open tabbladen en hun gewijzigd-vlag blijven dus ongemoeid. Wat de handler
wijzigt, loopt via de gewone API, bijvoorbeeld `applyAnnotationBatch` (één
undo-stap).

### 16.7 Tijdgrens, annuleren en herladen

- Elke aanroep heeft een eigen `AbortController`. Het signaal gaat af bij
  de tijdgrens (`COMMAND_TIMEOUT`), bij `notifications/cancelled` van de
  client (`COMMAND_CANCELLED`), bij `unregisterCommand`
  (`COMMAND_UNREGISTERED`) en bij uitzetten of herladen van de extensie
  (`EXTENSION_UNLOADED`). De aanroeper krijgt die uitkomst meteen.
- **Ongeldig maken.** Na het afbreken bereikt een laat resultaat van de
  handler de aanroeper niet meer, en de opdracht is uit het register en
  uit `tools/list`. Een handler die wijzigt, kijkt vóór het vastleggen naar
  `ctx.signal.aborted`. Rondt hij toch af, dan onthoudt de idempotentie dat
  resultaat. Een herhaling krijgt dan dat resultaat in plaats van een
  tweede wijziging.
- **Annuleren door de client.** Rust geeft het JSON-RPC-id van de
  `tools/call` mee als `rpcId`. Op `notifications/cancelled` met
  `requestId` stuurt Rust `mcp:cancel-extension-command`, en de dispatcher
  annuleert de lopende aanroepen met dat id. Over HTTP delen alle clients
  één server: twee clients met hetzelfde JSON-RPC-id kunnen elkaars
  aanroep annuleren. Dat is een bewuste grens; een wijziging is daarna met
  dezelfde sleutel veilig te herhalen.
- **Herladen** ruimt via de bijdragescope (§4) de opdrachten op
  (`structuredCommand` is een bewaakte soort) en annuleert hun lopende
  aanroepen. De nieuwe versie registreert dezelfde namen opnieuw. De lijst
  naar Rust wordt in zijn geheel vervangen, dus er ontstaan geen dubbele
  tools.

### 16.8 Bestandspaden en handles

- De dispatcher geeft de handler alleen JSON door. Hij geeft geen
  bestandstoegang, opent niets en verruimt geen rechten. Wat een handler
  met een pad kan, hangt alleen af van wat de extensie al kon.
- `format: 'local-path'` controleert alleen de vorm. Het pad is absoluut en
  lokaal (`C:\…`, `C:/…` of `/…`), zonder netwerkshare, apparaatpad
  (`\\?\`, `\\.\`), URL, `..`-segment of stuurtekens, en hooguit 4096
  tekens. Een pad dat daar niet aan voldoet, geeft `INVALID_ARGUMENT`
  voordat de extensie het ziet. Of het bestand bestaat of gelezen mag
  worden, beslist deze controle niet.
- Voor open documenten zijn er **handles** in plaats van paden: het
  document-id uit `app_list_tabs` of `getDocumentInfo()`, met de revisie
  uit §16.6. Een headless aanroeper hoeft dan geen pad te kennen, en de
  extensie hoeft geen bestand te openen.
- In dit pad is geen bestandsdialoog. Een opdracht die een dialoog nodig
  heeft, hoort niet als gestructureerde opdracht.

### 16.9 Tests

`js/plugins/structured-commands.test.mjs` (in `scripts/unit-testlijst.txt`)
controleert:

- schema's buiten de deelverzameling, onbekende velden met het pad in de
  foutmelding, en `local-path`;
- toolnamen en registratiefouten;
- registreren via de echte `createPluginApi` (met `plugin-api-stubs.mjs`)
  en de vorm in `tools/list`;
- een ongeldig veld wordt geweigerd vóór de handler;
- drie gelijktijdige aanroepen krijgen elk hun eigen resultaat en
  `requestId`;
- een herhaalde wijziging maakt één resultaat, ook gelijktijdig, en een
  andere aanroep met dezelfde sleutel wordt geweigerd;
- een mislukte wijziging is herhaalbaar;
- een verouderde documentrevisie en een onbekend document worden geweigerd
  zonder andere documenten te raken;
- het uitvoerschema;
- de tijdgrens, met een later bewaard resultaat;
- herladen annuleert, ruimt op en laat precies één tool achter;
- annuleren op `rpcId`, en `EXTENSION_BUSY`;
- `app_call_extension_command`;
- de aansluiting op brug, Rust, metatabel, `tools.json` en manifest.

In Rust: `mcp_extensie_tools::tests` (namen, lijst, een oudere lijst
negeren) en `extensieopdrachten_zijn_aan_te_roepen_via_mcp`.
