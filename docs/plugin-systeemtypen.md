# Systeemtypen in de plugin-API en MCP (#567): ontwerp van het publieke contract

Status: gebouwd volgens dit ontwerp, inclusief punt 7 van #567 (de
documentgebonden geometriesnapshot, §12a), nog niet gecommit; handmatige
controle in de app staat nog open, zie §14.4. Basis: `main` op c8459398.
Alle paden zijn relatief aan `open-pdf-studio/`, tenzij ze met `../`
beginnen. Waar de bouw een keuze moest maken die het ontwerp openliet, staat
dat hieronder bij de betreffende paragraaf.

## 1. Doel en afbakening

De bibliotheek met systeemtypen staat in `preferences.systeemTypen`. Wie hem
nu wil gebruiken, heeft drie bouwstenen: de pure module
`js/annotations/systeem-typen.js`, de registry
`js/annotations/systeem-typen-registry.js` en de editor
`js/solid/components/dialogs/SysteemtypenDialog.jsx`. Extensies en
MCP-clients kunnen er niet op een ondersteunde manier bij. Het enige wat ze
hebben is `api.getPreferences()`, en dat geeft het live object terug, zodat
een extensie buiten elke validatie om kan schrijven.

Dit ontwerp beschrijft één contract. Plugin-API en MCP gebruiken
allebei dezelfde pure regels en dezelfde registry:

1. losgekoppelde, gevalideerde snapshots lezen (alle typen, of één type op id);
2. extensietypen registreren in een eigen namespace. Dat is idempotent, en
   een definitie die de gebruiker heeft bewerkt wordt nooit stil
   overschreven;
3. eigen typen bijwerken met een revisiecontrole, via de native persistentie
   en redraw;
4. de native editor openen met de focus op een type, met behoud van de
   werkkopie en van de semantiek van Annuleren;
5. na een bevestigde wijziging een melding sturen;
6. hetzelfde via MCP: lijst, registreren, bijwerken en editor openen. Dat
   gaat zonder GUI-automatisering en zonder het preferences-bestand te
   vervangen;
7. een gevalideerde, losgekoppelde geometriesnapshot van een systeem-instance
   in het document lezen, via plugin-API en MCP: uit de native geometrie, in
   millimeters in het eigen assenstelsel van het systeem, met document- en
   typerevisie en de bevestiging van de maten (§12a).

Buiten de afbakening vallen: een aparte extensie-editor, het verwijderen van
typen via de API, dynamische MCP-tools per extensie (#550 en #556) en
push-meldingen over MCP. Dat laatste kan niet: `listChanged:false` en het
transport is alleen request/response.

### Constructie versus productidentiteit

Een systeemtype beschrijft alleen de **constructiegeometrie en de
classificatie**: naam, categorie, IFC-mapping, layout, maten, randprofiel,
sparingsregels en paneelassortiment. **Productidentiteit** blijft in de
catalogus van de extensie, die er via het stabiele type-id naar verwijst.
Voorbeelden van productidentiteit zijn artikelnummer, leverancier, prijs,
brandklasse en documentatie-URL. Het contract kent daarom geen vrij
"extra data"-veld, en een onbekend veld wordt geweigerd (§5). Het stabiele
id is de enige brug tussen catalogus en tekening. De `naam` is een
weergavetekst en geen identiteit.

## 2. Datamodel (opslag)

### 2.1 Bibliotheek, versie 2

`SYSTEEMTYPE_VERSION` gaat van 1 naar 2. Migratiestap `MIGRATIONS[1]` voegt de
metadata hieronder toe. Elk bestaand type krijgt `revisie: 1`.

```js
{
  version: 2,
  revisie: 0,          // bibliotheekrevisie, +1 per commit (niet per type)
  verwijderd: [],      // grafstenen: [{ id, revisie }] van eigendomstypen die de gebruiker verwijderde
  typen: [type, ...],
}
```

Een type krijgt twee metadatavelden. Die horen bij het genormaliseerde model,
zodat ze de dialoog, de migratie en de PDF-snapshot overleven:

| veld | betekenis |
|---|---|
| `revisie` | geheel getal ≥ 1. Het begint bij 1 en gaat met +1 bij elke bevestigde wijziging van de definitie, door wie dan ook. Een schrijfactie zonder inhoudelijke wijziging verhoogt hem niet. |
| `eigenaarRevisie` | Alleen bij typen met een eigenaar (§3). Dit is de `revisie` waarop de eigenaar de definitie voor het laatst schreef met registreren of bijwerken. Ontbreekt hij, dan telt hij als 0. |

Afgeleid: **door de gebruiker bewerkt** ⇔ het type heeft een eigenaar en
`revisie > (eigenaarRevisie ?? 0)`. Een bewerking in de editor of in het
eigenschappenpaneel verhoogt `revisie` maar niet `eigenaarRevisie`, en zet
daarmee die markering. Er komt geen apart vlagveld dat los kan raken van de
revisies.

Een snapshot uit een PDF zonder `eigenaarRevisie` bij een extensie-id telt
als bewerkt door de gebruiker (0 < revisie). Dat is de veilige kant: bij
twijfel overschrijft een registratie niets.

### 2.2 Normalisatie zonder verzonnen maten

`normalizeSysteemType` vult **geen fysieke maten** meer in. Ontbreekt een maat
of is hij ongeldig, dan blijft hij weg en is hij **onbevestigd**. Het gaat om
`celXMm`, `celYMm`, `strookBreedteMm` en `sparingRegels.*`. Weergavekeuzes
houden wel een gedocumenteerde standaard:

- `edgeProfiel` ontbreekt: `'geen'`;
- `paneelTypen` ontbreekt of is leeg: het standaardassortiment;
- `'tegel'` wordt altijd aangevuld, omdat dat de terugvalwaarde van elke cel
  is.

Gevolgen:

- `createDefaultSysteemTypen()` schrijft de waarden die nu impliciet zijn
  **expliciet** uit: `strookBreedteMm: 1200` en
  `sparingRegels: { kleineSparingMaxMm: 400, raveelVanafMm: 800 }` bij elk
  meegeleverd type. De ingebouwde typen blijven daardoor bit-voor-bit gelijk,
  met dezelfde vaste id's. De deepEqual-rondgang in
  `scripts/test-systeemraster.mjs:476-477` blijft slagen.
- Opgeslagen v1-data is altijd door de oude normalisatie gegaan en heeft dus
  alle maten. Na de migratie is er niets onbevestigd, behalve rommel.
- De kortsluiting in `migrateSysteemTypen` gaat weg
  (`systeem-typen.js:181-184`). Die gaf ruwe, niet-genormaliseerde invoer
  terug, met onbekende velden erin. Het resultaat is voortaan altijd
  genormaliseerd. Is de invoer al precies de genormaliseerde vorm (canonieke
  JSON gelijk), dan komt dezelfde referentie terug; zo zien aanroepers als
  `mergeSysteemType` en `updateSysteemTypeIn` "niets veranderd" aan de
  referentie. De registry-getter schrijft alleen terug als er iets verschilt,
  zodat lezen geen schijnwijziging oplevert, en onthoudt de gecontroleerde
  bibliotheek: zolang de preferences dezelfde referentie hebben, wordt er niet
  opnieuw gemigreerd (het tekenen vraagt het type per annotatie op).
- Dubbele id's: alleen het eerste exemplaar blijft. Dat is nieuw in de
  migratie.
- `duplicateSysteemType` valt nu terug op `normalizeSysteemType({ id: 'st-x' })`.
  Die terugval levert voortaan een type zonder maten op. Dat is bedoeld:
  bij een kopie zonder bron is niets bevestigd.

### 2.3 Wat de geometrie met onbevestigde maten doet

Welke maten **vereist** zijn, hangt van de layout af:

- `raster`: `celXMm` en `celYMm`;
- `strook`: `strookBreedteMm` en `celYMm`. De strook-layout gebruikt `cellH`
  nog voor de randindeling en de index (`systeemraster.js:747` en `:1006`).

Als `buildSysteemraster` een `typeDef` krijgt waarvan een vereiste maat
onbevestigd is, gebeurt het volgende:

- er wordt **geen** standaardmaat ingevuld. De fallback naar 2000 in
  `resolveSysteemrasterParams` geldt alleen nog voor legacy-instances
  zonder type;
- de geometrie heeft geen cellen, stroken of panelen, en wel
  `onbevestigd: ['celXMm', ...]`;
- het tekenen laat de contour zien met het label "maat onbevestigd"
  (`SYSTEEM_ONBEVESTIGD_LABEL`). Dat label staat er ook als de tag van de
  instance uit staat: de tekening mag geen maat suggereren die niet bevestigd
  is;
- `geom.params.plaatBreedteMm` of `plaatHoogteMm` is dan `null`; randstukken
  (`randMm`) zijn 0, want er is geen indeling;
- bij de strook-layout is de plaatbreedte in de geometrie (en in de tag) de
  `strookBreedteMm`, niet `celXMm`;
- de oppervlakte blijft beschikbaar, aantallen niet;
- `sparingRegels` onbevestigd: elke sparing is een gewoon gat, zonder
  verzwaarde rand of raveel. De fallback naar
  `SYSTEEM_SPARING_REGELS_DEFAULT` (`systeemraster.js:882`) vervalt als er een
  `typeDef` is. Er zijn **beide** drempels nodig; ontbreekt er één, dan
  gelden de sparingsregels als onbevestigd (`sparingRegelsVoorType` geeft
  `null`, `sparingRegime` geeft dan altijd `'klein'`). Het eigenschappenpaneel
  gebruikt dezelfde regel;
- de saver laat `OPS_SgPlaatB/H` weg voor een onbevestigde maat. De loader
  valt alleen terug op 2000 voor instances **zonder** type
  (`annotation-converter.js:793-794`). Bij een instance met een type bepaalt
  het type de maat.

De gebruiker bevestigt een maat in de editor of in het eigenschappenpaneel.
Dat is een gewone, bevestigde bewerking (§7). Het eigenschappenpaneel toont
een onbevestigde typemaat als leeg veld met de placeholder "onbevestigd".

Bekende compatibiliteitsgrens: een oudere build normaliseert de snapshot met
zijn eigen standaardwaarden en toont een onbevestigd type dus met 600 × 600.

### 2.4 Lagen: betekenis en ondersteunde versie

Het **contractschema** is versie 1 (`schema: 1`) en kent precies **één
impliciete laag**. De definitie van het type is zelf die laag: celmaat of
strook, randprofiel, sparingsregels en paneelassortiment. Die laag hoort bij
`ann.system.layers[0]` van de instance, waar paneel-overrides op
`paneelTypen[].id` verwijzen en randen per segment staan. De geometrie leest
nu alleen `layers[0]` (`systeemraster.js:36-41` en `:188-215`). Het typeveld
`lagen` wordt nergens gelezen.

Daarom geldt:

- `lagen` mag ontbreken of `[]` zijn. Alles anders wordt geweigerd met
  `unsupported-field` en de melding *"layered system types are not supported
  by schema 1 (one implicit layer)"*.
- `lagen` is gereserveerd voor een later schema 2 met gelaagde systemen. Dat
  schema legt de vorm van een laag-element vast, plus hoe instance-laag `n`
  naar typelaag `n` verwijst. Tot dat schema er is, neemt de host geen
  laagdata aan die geen effect heeft.
- Staat er in de opslag of in een PDF-snapshot toch een niet-lege `lagen`, dan
  blijft die ongemoeid bewaard (geen dataverlies), ook als de eigenaar het
  type later bijwerkt zonder `lagen` mee te geven (§6.3). De publieke
  snapshot geeft dan `lagen: []` en meldt het veld in `problems` (§4.2). Alleen
  een expliciete `lagen: []` of `null` in `changes` haalt hem weg.

## 3. Eigendom en namespace

Het eigendom zit **in het id zelf**. Er is geen los eigenaarveld dat kan gaan
afwijken.

| soort | id-vorm | wie mag bijwerken via API of MCP |
|---|---|---|
| app (meegeleverd of door de gebruiker gemaakt) | alles wat niet met `ext:` of `mcp:` begint, in de praktijk `st-…` | niemand: alleen de gebruiker, in de editor of het paneel |
| extensie | `ext:<extensionId>#<key>` | alleen de extensie met dat `pluginId` |
| MCP-client | `mcp:<key>` | alleen MCP (één gedeelde namespace) |

Grammatica:

- `extensionId`: `^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$`. Dit is
  het `manifest.id` uit de closure van `createPluginApi(pluginId)`. Een
  plugin-id dat hier niet aan voldoet, kan geen systeemtypen registreren en
  krijgt `invalid-owner`. De andere API's blijven werken.
- `key`: `^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`. Kleine letters, zodat er
  geen hoofdlettergevoelige dubbelingen ontstaan. De extensie kiest de key
  zelf en houdt hem stabiel. Het is de sleutel van haar catalogus.
- Hulpfunctie `api.systemTypeId(key)` geeft `ext:<eigen id>#<key>`.

Gevolgen:

- Een extensie kan nooit een type van een andere extensie, van MCP of van de
  app bijwerken. Dat geeft `not-owner`, nooit een waarschuwing gevolgd door
  overschrijven.
- **Dupliceren** in de editor geeft altijd een nieuw `st-`-id. De kopie is van
  de gebruiker.
- Komt een `ext:`-id binnen via een PDF-snapshot, dan blijft het eigendom bij
  de extensie in dat id. De extensie kan het type later bijwerken volgens de
  gewone regels.

## 4. Plugin-API

Detectie: `api.features.systemTypes === true`. Het contractschema is 1. Alle
functies zijn synchroon. Afwijzingen gooien een `Error` met
`name === 'SystemTypeError'`, een `code` (§4.4), optioneel `field` en, bij
`stale-revision`, `currentRevision`. Uitkomsten die geen fout zijn, zoals "al
gelijk" of "gebruikersbewerking behouden", komen als `status` terug en worden
niet gegooid.

### 4.1 Overzicht

```js
api.listSystemTypes(options?)            // → SystemTypeSnapshot[]
api.getSystemType(id)                    // → SystemTypeSnapshot | null
api.systemTypeId(key)                    // → 'ext:<pluginId>#<key>'
api.registerSystemType(key, definition, options?)
                                         // → { status, type }
api.updateSystemType(id, changes, { expectedRevision, schema? })
                                         // → { status, type }
api.selectSystemTypeForTool(id)          // → { tool: 'systeemplafond', typeId, active }
api.openSystemTypeEditor(id)             // → { opened, typeId }
api.onSystemTypesChanged(listener)       // → unsubscribe()
api.getSystemInstanceGeometry(annotationId, { expectedDocumentRevision?, expectedTypeRevision?, schema? })
                                         // → SystemGeometrySnapshot | null (§12a)
```

- `listSystemTypes({ owned: true })` geeft alleen de typen van de aanroeper.
  Zonder opties geeft hij alle typen, in de volgorde van de bibliotheek. Een
  andere optie, of `owned` dat geen boolean is, geeft `invalid-argument`.
- `getSystemType(id)` geeft `null` voor een onbekend of verwijderd id. Dat
  volgt het patroon van `getScaleAt`.
- `registerSystemType(key, definition, { schema?: 1, restore?: boolean })`,
  zie §6.
- `updateSystemType(id, changes, { expectedRevision, schema?: 1 })`, zie §6.3.
- `selectSystemTypeForTool(id)`, zie §8.
- `openSystemTypeEditor(id)`, zie §9.
- `onSystemTypesChanged(listener)`, zie §10.
- `getSystemInstanceGeometry(annotationId, options?)`, zie §12a.
- Na `dispose` (deactiveren, §11) weigeren `registerSystemType`,
  `updateSystemType`, `selectSystemTypeForTool`, `openSystemTypeEditor` en
  `onSystemTypesChanged` met `disposed`. Lezen (`listSystemTypes`,
  `getSystemType`, `systemTypeId`, `getSystemInstanceGeometry`) blijft werken.

Voorbeeld voor een synthetische extensie:

```js
export function activate(api) {
  if (api.features?.systemTypes !== true) return;
  const { status, type } = api.registerSystemType('mineraal-600x600', {
    naam: 'Mineraalplaat 600x600',
    categorie: 'plafond',
    ifcCategory: 'IfcCovering',
    ifcPredefinedType: 'CEILING',
    layout: 'raster',
    celXMm: 600,
    celYMm: 600,
    edgeProfiel: 'schaduwvoeg',
  });
  // status: 'created' | 'unchanged' | 'updated' | 'kept-user-edit' | 'removed-by-user'
  const stop = api.onSystemTypesChanged(({ changes }) => {
    for (const c of changes) if (c.type?.owner.extensionId === api.pluginId) syncCatalog(c);
  });
  api.selectSystemTypeForTool(type.id);   // de native tool tekent met dit type
  api.openSystemTypeEditor(type.id);      // de native editor, met de focus op dit type
}
```

### 4.2 Snapshotvorm (`SystemTypeSnapshot`)

Elke aanroep geeft een **verse diepe kopie** terug, gemaakt met
`JSON.parse(JSON.stringify(...))`. Muteren ervan heeft geen effect op de
registry.

```js
{
  id: 'ext:nl.voorbeeld.plafondcatalogus#mineraal-600x600',
  schema: 1,
  owner: { kind: 'extension', extensionId: 'nl.voorbeeld.plafondcatalogus',
           key: 'mineraal-600x600', loaded: true },
       // of { kind: 'mcp', key } of { kind: 'app' }
  revision: 3,
  ownerRevision: 2,          // null bij kind 'app'
  userEdited: true,          // null bij kind 'app'
  definition: {              // alleen gevalideerde schema-1-velden, native veldnamen
    naam, categorie, ifcCategory, ifcPredefinedType?, layout,
    celXMm?, celYMm?, strookBreedteMm?, edgeProfiel,
    sparingRegels?: { kleineSparingMaxMm?, raveelVanafMm? },
    paneelTypen: [{ id, naam, renderStijl }], lagen: [],
  },
  unconfirmed: ['celYMm'],   // ontbrekende fysieke maten (vereiste en sparingRegels.*)
  problems: [],              // [{ field, code, message }] voor opgeslagen waarden die schema 1 niet doorstaan
}
```

- De velden in `definition` houden de **native namen**. Zo staan ze ook in de
  preferences en in `OPS_SgTypeDef`. Er komt geen tweede vocabulaire die
  heen en terug vertaald moet worden.
- Een veld dat in de opslag zit maar de validatie niet doorstaat,
  bijvoorbeeld uit een oude of vreemde PDF-snapshot, staat **niet** in
  `definition`. Het staat in `problems`, met dezelfde codes als in §4.4. Een
  onbevestigde maat is geen probleem. Die staat in `unconfirmed`.
- `owner.loaded` zegt of de extensie op dit moment geladen is. Een extensie
  telt als geladen zolang er een plugin-API voor haar id actief is: van het
  aanmaken (vóór `activate`) tot `_cleanup`. De plugin-API meldt dat bij de
  registry (`meldExtensieActief`); zo hoeft de registry de plugin-manager niet
  te importeren, en ziet een extensie tijdens haar eigen `activate` al
  `loaded: true` (de plugin-manager noteert een plugin pas ná `activate`).

### 4.3 Geldige definitievelden (schema 1)

Dit is de expliciete lijst. **Elk ander veld wordt geweigerd** met
`unknown-field`. Dat geldt ook voor geneste objecten.

| veld | type en regels | verplicht bij registreren | ontbreekt |
|---|---|---|---|
| `naam` | string, na trim 1–200 tekens | ja | – |
| `categorie` | `'plafond'`, `'vloer'`, `'wand'` of `'overig'` | ja | – |
| `layout` | `'raster'` of `'strook'` | ja | – |
| `ifcCategory` | `'IfcCovering'`, `'IfcWall'`, `'IfcSlab'` of `'IfcPlate'` | nee | `'IfcCovering'` (classificatie, geen maat) |
| `ifcPredefinedType` | `'CEILING'`, `'FLOORING'`, `'FLOOR'`, `'CLADDING'`, `'ROOFING'` of `null` | nee | geen |
| `celXMm`, `celYMm` | eindig getal, 50 ≤ v ≤ 20000 (`SYSTEEMRASTER_PLAAT_RANGE`), **niet geklemd** | nee | onbevestigd |
| `strookBreedteMm` | als hierboven | nee | onbevestigd |
| `edgeProfiel` | `'geen'`, `'hoeklijn'` of `'schaduwvoeg'` | nee | `'geen'` |
| `sparingRegels` | object met alleen `kleineSparingMaxMm` en/of `raveelVanafMm`, elk eindig, 10 ≤ v ≤ 20000; als beide er zijn: klein ≤ raveel | nee | onbevestigd |
| `paneelTypen` | array met 1–50 elementen `{ id, naam, renderStijl }`, alle drie verplicht; de grens geldt voor het **opgeslagen** assortiment: zonder een element met id `'tegel'` (dat wordt aangevuld) mogen er 49 zijn; `id` volgens `^[a-z0-9][a-z0-9_-]{0,63}$` en uniek; `naam` 1–200 tekens; `renderStijl` is `'tegel'`, `'ventilatie'` of `'licht'` | nee | standaardassortiment; `'tegel'` wordt aangevuld |
| `lagen` | alleen `[]` (§2.4) | nee | `[]` |

Verder:

- **Niet toegestaan** in een definitie of in `changes`: `id`, `revisie`,
  `eigenaarRevisie` en de snapshotvelden `revision`, `owner`, enzovoort. Die
  geven `readonly-field`.
- Waarden moeten JSON-zuiver zijn: platte objecten, eindige getallen, geen
  functies of cycli. Hiervoor wordt `assertSerializable` uit
  `annotation-batch.js` gedeeld (die functie is daarvoor geëxporteerd). Een
  overtreding geeft `invalid-field`.
- Daarna maakt de host een losgekoppelde kopie (`JSON.parse(JSON.stringify())`)
  en controleert en bewaart **die**. Elke waarde wordt zo precies één keer
  gelezen: een getter kan na de controle geen andere waarde meer teruggeven.
  De opties (`expectedRevision`, `restore`, `schema`) worden ook één keer
  gelezen.
- Elke geaccepteerde registratie geeft een snapshot zonder `problems`: wat de
  ingang doorlaat, doorstaat ook de controle van de snapshot.
- `null` in `changes` haalt een optioneel veld weg. Bij een maat maakt dat de
  maat onbevestigd. Bij `ifcPredefinedType` betekent het geen predefined
  type. Bij `ifcCategory`, `edgeProfiel`, `paneelTypen` en `lagen` komt de
  standaard uit de kolom "ontbreekt" terug. `null` op een verplicht veld geeft
  `invalid-field`. Bij registreren betekent `null` op een optioneel veld: niet
  gegeven.
- `sparingRegels` zonder drempel (`{}`) geeft `invalid-field`; geef `null` om
  de regels weg te halen.
- Geneste waarden (`sparingRegels` en `paneelTypen`) gaan altijd **in hun
  geheel** mee, zonder diepe merge. Dat is dezelfde regel als bij
  `applyAnnotationBatch`.
- `options.schema` mag ontbreken of 1 zijn. Een andere waarde geeft
  `unsupported-version`. Zo krijgt een extensie die voor een later schema is
  geschreven op een oudere host een duidelijke weigering.
- Een combinatie van IFC-categorie en predefined type wordt in schema 1 niet
  op samenhang gecontroleerd.

### 4.4 Foutcodes

Dezelfde codes gelden voor de plugin-API (`error.code`) en voor MCP
(`{ ok:false, code, error }`). De teksten zijn Engels.

| code | wanneer |
|---|---|
| `invalid-argument` | argumenten hebben de verkeerde vorm: geen object, `expectedRevision` geen geheel getal ≥ 1, onbekende optie |
| `invalid-owner` | het plugin-id past niet in de namespace-grammatica |
| `invalid-key` | `key` past niet in de grammatica |
| `unknown-field` | veld buiten §4.3, ook genest (`field` geeft het pad, bijvoorbeeld `sparingRegels.foo`) |
| `invalid-field` | verkeerd type, buiten bereik, onbekende enum-waarde, dubbel paneeltype-id, meer dan 50 paneeltypen (inclusief het aangevulde `'tegel'`), klein > raveel, `null` op een verplicht veld |
| `missing-field` | verplicht veld ontbreekt bij registreren |
| `unsupported-field` | `lagen` niet leeg (schema 1) |
| `unsupported-version` | `schema` is niet 1 |
| `readonly-field` | `id` of metadata in een definitie of in `changes` |
| `not-found` | onbekend of verwijderd id (bijwerken, tool kiezen, editor openen) |
| `not-owner` | bijwerken van een type van een andere eigenaar (app, andere extensie, MCP) |
| `stale-revision` | `expectedRevision` is niet de huidige `revisie`; geeft `currentRevision` mee. Bij de geometrie (§12a): `expectedDocumentRevision` of `expectedTypeRevision` is verouderd; `field` zegt welke, `currentRevision` geeft de huidige |
| `disposed` | alleen plugin-API: de api van een gedeactiveerde extensie (na `_cleanup`) wijzigt niets, kiest geen tool, opent geen editor en neemt geen listener meer aan |
| `not-stored` | alleen MCP: de wijziging is niet uit de bibliotheek terug te lezen (nooit `ok:true` zonder terug te lezen) |

Via MCP draagt een fout naast `code` en `error` ook `field` en
`currentRevision` als de plugin-API ze heeft.

Elke afwijzing is **atomair**. Alles wordt eerst gevalideerd. Bij een fout
verandert er niets aan registry, persistentie, documenten of tool-selectie,
en gaat er geen melding uit.

## 5. Waarom onbekende velden geweigerd worden

Het huidige model laat onbekende velden stil vallen (`normalizeSysteemType`).
Via de migratiekortsluiting laat het ze juist ongecontroleerd door. Voor het
publieke contract geldt **weigeren**. Daar zijn twee redenen voor:

1. Een veld dat stil verdwijnt, lijkt bewaard maar is het niet. Daarmee breekt
   de regel "nooit ok:true zonder terug te lezen" (`annotatie-lagen-mcp.js:23-25`).
2. Productidentiteit mag niet via vrije velden in de constructiedefinitie
   terechtkomen (§1).

De native normalisatie zelf blijft tolerant voor bestaande opslag en
PDF-snapshots. Alleen de **ingang** van de API en MCP is streng.

## 6. Registreren en bijwerken

### 6.1 `registerSystemType(key, definition, options)`, beslisvolgorde

De pure functie `planRegistratie(data, eigenaar, key, definitie, opties)` loopt
deze stappen af:

1. Valideer de eigenaar, de key en de definitie (§4.3, registreermodus). Een
   fout wordt gegooid.
2. Bepaal `id = ext:<pluginId>#<key>`.
3. Staat `id` in `verwijderd` en is `restore` niet true? Dan komt
   **`removed-by-user`** terug, met `type: null`. Er wordt niets
   geschreven.
4. Bestaat het id niet? Dan **`created`**: `revisie = 1`, of bij een
   grafsteen `grafsteen.revisie + 1`, en `eigenaarRevisie = revisie`. Er
   volgt een commit met melding `added`. Revisies lopen per id door, ook
   voorbij een verwijdering: een snapshot van vóór het verwijderen blijft
   verouderd en geeft bij bijwerken `stale-revision` (geen ABA). Hetzelfde
   geldt als een PDF of de editor een gegraven id terugbrengt (§7, §9.2).
5. Bestaat het id en is de canonieke definitie gelijk? Dan **`unchanged`**,
   zonder commit en zonder melding. Dit geldt ook als het type ooit door de
   gebruiker bewerkt is.
6. Bestaat het id en is het door de gebruiker bewerkt (`revisie >
   eigenaarRevisie`)? Dan **`kept-user-edit`**. De versie van de gebruiker
   blijft staan en komt terug in `type`. Er wordt niets geschreven.
7. Bestaat het id, is het niet door de gebruiker bewerkt en is de definitie
   anders? Dan **`updated`**: `revisie + 1` en
   `eigenaarRevisie = revisie`. Er volgt een commit met melding `updated`.
   Het is de eigen, onbewerkte definitie van de extensie, dus een nieuwe
   catalogusversie mag haar vervangen.

Canoniek vergelijken gebeurt op de genormaliseerde definitievelden, met
gesorteerde sleutels. Metadata telt daarbij niet mee.

`restore: true` haalt de grafsteen weg en gaat verder bij stap 4. Een
extensie hoort dit alleen te doen na een expliciete gebruikersactie in haar
eigen UI, bijvoorbeeld "catalogustype terugzetten".

Dit is idempotent. Bij elke activatie en na een reinstall (unload en load,
`plugin-manager.js:89-109`) geeft dezelfde aanroep `unchanged` of
`kept-user-edit`, en nooit een tweede type. Het id is deterministisch, dus
een duplicaat is uitgesloten.

### 6.2 Opzettelijk een gebruikersbewerking vervangen

Bij `kept-user-edit` beslist de extensie, en vraagt het liefst eerst de
gebruiker. Wil ze vervangen, dan roept ze
`updateSystemType(id, definition, { expectedRevision: type.revision })` aan.
Omdat ze de huidige revisie moet opgeven, heeft ze aantoonbaar de versie van
de gebruiker gezien. Het overschrijven is dan expliciet en niet stil.

### 6.3 `updateSystemType(id, changes, { expectedRevision })`

De pure functie `planBijwerking` loopt deze stappen af:

1. `id` onbekend of verwijderd: `not-found`.
2. Eigenaar uit `id` ≠ aanroeper: `not-owner`. Dat geldt voor app-typen, typen
   van andere extensies en `mcp:`-typen.
3. `expectedRevision` ontbreekt of is geen geheel getal ≥ 1:
   `invalid-argument`. Is hij niet gelijk aan `revisie`: `stale-revision`
   met `currentRevision`.
4. Valideer `changes` (§4.3, bijwerkmodus). Alleen de **gegeven** velden
   worden gecontroleerd en vervangen; een genest veld (`sparingRegels`,
   `paneelTypen`) als geheel, met zijn eigen samenhangsregels (klein ≤
   raveel, de grens van 50 paneeltypen). Alle andere velden komen
   **ongewijzigd uit de opslag**: ook een opgeslagen waarde die schema 1 niet
   doorstaat (een bewerking van de gebruiker in het eigenschappenpaneel, een
   oude PDF-snapshot) en een niet-lege `lagen`. Er verdwijnt niets stil; de
   snapshot blijft zulke waarden in `problems` melden.
5. Canoniek gelijk: `{ status: 'unchanged', type }`, zonder commit. Lege
   `changes` (`{}`) geven dus altijd `unchanged` en geen nieuwe revisie.
6. Anders `{ status: 'updated', type }`: `revisie + 1` en
   `eigenaarRevisie = revisie`. Er volgt een commit met melding `updated`.

## 7. Commit, persistentie en redraw (één pad voor iedereen)

In de registry komt `commitSysteemTypen(next, wijzigingen, bron)`. Elke
bevestigde wijziging gaat erdoorheen:

| bron (`source`) | wie |
|---|---|
| `extension` | `registerSystemType` en `updateSystemType` (plus `sourceExtensionId`) |
| `mcp` | `app_register_system_type` en `app_update_system_type` |
| `editor` | Toepassen of OK in de dialoog |
| `properties-panel` | type-velden in het paneel (`propertiesStore.js:938-959`, via `updateSysteemType`) |
| `document` | een PDF-snapshot die een **nieuw** id toevoegt (`ensureSysteemType`, loader) |

De commit doet dit, in deze volgorde:

1. `library.revisie + 1` en `state.preferences.systeemTypen = next`.
2. `savePreferences()` aanvragen (lazy import, zoals nu). Een mislukte write
   wordt gelogd met `console.warn` en niet stil ingeslikt.
3. Een redraw van het actieve document aanvragen (lazy import van
   `rendering.js`: `redrawContinuous` of `redrawAnnotations`). Daarnaast
   worden de typevelden in het eigenschappenpaneel ververst. Het tekenen
   resolveert het type per beurt, zonder cache (`rendering.js:1941-1972`),
   dus een redraw is genoeg.
4. De melding versturen (§10), alleen als er wijzigingen zijn. Elke
   registry-listener draait in een eigen try/catch.

Het paneel wordt ververst met `storeVerversSysteemType` (propertiesStore).
Die zet alleen de velden die van het type afhangen (plaatmaat, typelijst,
layout, randprofiel, paneelassortiment, IFC-pad en de IFC-categorie van de
instance), en alleen als het paneel precies één systeem toont. Er komt geen
nieuwe selectie en geen selectiemelding naar plugins
(`fireSelectionChange`), en een meervoudige selectie of een ander
annotatietype in het paneel blijft ongemoeid. Een mislukte redraw of
paneelverversing wordt ook met `console.warn` gelogd.

`saveSysteemTypen` blijft bestaan als dunne compatibiliteitsfunctie, maar
roept niemand meer rechtstreeks aan. Hij legt de gegeven bibliotheek als
editorbewerking over de huidige stand (alleen het verschil, bron `editor`).

`ensureSysteemType` uit de loader verandert inhoudelijk niet: een bestaand id
wint, stil en zonder melding. Wel geldt voortaan: staat het id als grafsteen
in `verwijderd`, dan voegt het document het type toch weer toe. Het document
heeft het nodig om te tekenen. De grafsteen vervalt dan, en het type krijgt
een revisie ná die van de grafsteen (`revisieNaGrafsteen`); de afstand tussen
`revisie` en `eigenaarRevisie` uit de snapshot blijft gelijk, zodat "door de
gebruiker bewerkt" niet verandert.

Bij het laden is het type ook leidend voor het IFC-predefined type van de
instance (`ifcPredefinedNaLaden`): met een gevonden type geldt zijn
predefined type, anders de kopie die de instance zelf bewaarde
(`OPS_IfcPredefined`). De loader verzint geen `CEILING` meer omdat de native
tool elke getypeerde instance `system.type: 'plafond'` geeft (dat is het
datamodel met lagen, geen categorie). Alleen een instance zonder type krijgt
bij het plafondmodel nog `CEILING`.

## 8. Selectie in de native tool

- In de registry komt runtime-state `toolSysteemTypeId`. Die wordt niet
  bewaard. Daarbij horen `zetToolSysteemType(id)`,
  `getToolSysteemTypeId()`, `kiesToolSysteemType(id, activeer)`,
  `toolSysteemGeactiveerd()`, `toolSysteemGedeactiveerd()` en
  `wisToolSysteemTypeVanExtensie(extensionId)`.
- De keuze geldt alleen voor de **tool-sessie** die
  `selectSystemTypeForTool` zelf start. `zetToolSysteemType` zet naast de
  selectie een eenmalige claim. De systeemplafond-tool meldt elke activering
  (`onActivate`) en deactivering (`onDeactivate`) aan de registry;
  `setTool` in `tools/manager.js` roept `onActivate` aan bij elke keuze van
  een tool, ook als het dezelfde tool is. De eerste activering na de keuze
  neemt de claim en houdt het gekozen type. Elke andere activering (het lint,
  de symbolenbibliotheek met "Systeemplafond (IfcCovering.CEILING)",
  `app_set_tool`) en elke wissel naar een ander gereedschap zet de tool terug
  op het standaardtype. Zo tekent de native tool nooit ongemerkt het type van
  een extensie.
- `api.selectSystemTypeForTool(id)` geeft `not-found` bij een onbekend id.
  Anders kiest hij het type, roept `setTool('systeemplafond')` aan en geeft
  `{ tool: 'systeemplafond', typeId, active }` terug. `active` is false als
  de tool niet geactiveerd kon worden (bijvoorbeeld bij een alleen-lezen
  PDF/A); dan blijft er geen keuze of claim hangen. De naam `systeemplafond`
  is historisch: het is de getypeerde variant en werkt voor elke categorie.
- In `systeemraster-tool.js` wordt `_annProps` voor de variant `'plafond'`
  gebaseerd op een pure `kiesToolType(data, toolSysteemTypeId)`. Die kiest het
  geselecteerde type, anders `'st-plafond-600x600'`, anders het eerste type.
  Daarbij gaan ook deze fouten eruit:
  - de bug op regel 212, waar `ifcCategory` die van het type uit regel 199
    overschrijft. Het type wint;
  - `plaatBreedteMm/plaatHoogteMm` komen uit het type, en niet langer uit de
    vaste 600. Is een maat onbevestigd, dan blijven die velden weg.
  De instance-velden komen uit de pure `typeInstanceVelden(type)`
  (`systeemTypeId`, `ifcCategory`, `ifcPredefinedType` als het type er een
  heeft, en de plaatmaat; bij de strook-layout is de plaatbreedte de
  strookbreedte). Alleen als de bibliotheek leeg zou zijn, krijgt de instance
  `ifcPredefinedType: 'CEILING'`.
- Een gekozen type met een onbevestigde maat mag. De instance toont de contour
  met "maat onbevestigd" (§2.3).
- Bij deactivatie van de extensie (`dispose` in `_cleanup`) vervalt haar
  eigen keuze: staat de tool op een `ext:<pluginId>#…`-type, dan gaat hij
  terug naar het standaardtype. De keuze van een andere extensie blijft
  staan. Het type zelf blijft altijd bestaan.

## 9. Native editor: openen en focus

### 9.1 Openen

`api.openSystemTypeEditor(id)` en `app_open_system_type_editor` werken zo:

- Een onbekend of verwijderd id geeft `not-found`. Elk eigendom is
  toegestaan: openen is geen bewerken, de gebruiker beslist.
- Een nieuwe store `js/solid/stores/systeemtypenEditorStore.js` krijgt de
  functie `openSysteemtypenEditor({ typeId })`, met dit gedrag:
  - **Dialoog dicht**: `openDialog('systeemtypen', { typeId })`. De dialoog
    leest `props.data?.typeId` voor de beginselectie, en valt terug op het
    eerste type. De werkkopie en de **basis** zijn allebei een diepe kloon
    van de huidige registry.
  - **Dialoog open**: er wordt niet opnieuw geopend, want dat zou de
    werkkopie weggooien, en `openDialog` ontdubbelt toch al. In plaats
    daarvan zet de store een focussignaal `{ typeId, volgnummer }`. Dankzij
    het volgnummer werkt een herhaalde focus op hetzelfde id ook. De dialoog
    reageert in een `createEffect` en verandert alleen de selectie
    (`focusOpType`). Onbevestigde wijzigingen aan andere typen blijven staan.
  - De store zet het signaal bij elke aanroep, ook als hij de dialoog opent.
    De dialoog onthoudt bij het openen het volgnummer dat er dan staat en
    negeert signalen tot en met dat nummer: een oud verzoek kan de
    beginselectie uit `props.data` niet overschrijven.
  - Zit het type nog niet in de werkkopie, omdat het na het openen is
    geregistreerd? Dan haalt de dialoog de huidige registryversie op in basis
    en werkkopie. Daarmee is het type niet gewijzigd. Heeft de gebruiker het
    type in de werkkopie verwijderd (het staat nog wel in de basis), dan
    gebeurt er niets: een focusverzoek maakt een onbevestigde verwijdering
    niet ongedaan.
- Resultaat: `{ opened: true|false, typeId }`. `opened` is false als er
  alleen opnieuw gefocust werd. De aanroep wacht nooit op de gebruiker, past
  niets toe en stuurt geen melding.
- `DialogHost.jsx` en `dialogStore.openDialog` blijven ongewijzigd.

### 9.2 Toepassen, OK en Annuleren

De logica van een geopende editor staat in een sessie zonder UI:
`maakEditorSessie({ host, typeId })` in
`js/solid/stores/systeemtypenEditorSessie.js`. De sessie houdt basis,
werkkopie, selectie, omzet-wachtrij, verwijdervraag en melding bij en heeft de
methoden `selecteer`, `muteer`, `nieuw`, `dupliceer`, `verwijder`,
`zetOmzetDoel`, `bevestigOmzetten`, `annuleerVerwijderVraag`, `toepassen`,
`annuleren` en `focus`. `SysteemtypenDialog.jsx` toont alleen wat de sessie
bijhoudt en geeft klikken door; de host is de registry
(`getSysteemTypenData`, `commitSysteemTypen`), de open documenten en
`redraw`. Zo draait het gedrag hieronder ook onder `node:test`.

- **Toepassen** gebruikt de pure functie
  `planEditorToepassen(basis, werk, huidig, wachtrij)`. Die schrijft alleen
  het **verschil** tegen de basis:
  - een type dat in de werkkopie gewijzigd is, krijgt de versie uit de
    werkkopie. De gebruiker wint, ook als de registry intussen veranderde.
    In de melding is dat te zien aan `previousRevision`;
  - typen die de werkkopie niet aanraakte, houden de **huidige**
    registryversie. Een type dat na het openen geregistreerd of bijgewerkt
    is, gaat dus niet verloren. Het huidige last-writer-wins
    (`SysteemtypenDialog.jsx:119-122`) vervalt daarmee;
  - nieuwe en gedupliceerde typen worden toegevoegd met `revisie: 1`;
  - verwijderde typen worden verwijderd. Bij een type met een eigenaar komt
    er een grafsteen `{ id, revisie }` in `verwijderd`;
  - na de commit wordt de basis de nieuwe stand, en de werkkopie een kopie
    daarvan (alles is toegepast).
- **Omzetten en verwijderen** muteert geen documenten meer direct. Het zet
  een omzetting `{ vanId, naarId }` in de wachtrij van de dialoog. Bij
  Toepassen worden de omzettingen eerst uitgevoerd
  (`reassignSysteemType` op open documenten, `doc.modified = true`), en pas
  daarna gaat de typewijziging via de commit. Er komt, net als nu, geen
  undo-stap; die gebeurt alleen nog na bevestiging. Alleen documenten waarin
  echt iets omgezet is, worden als gewijzigd gemarkeerd. Een tussendoel dat
  later zelf ook omgezet en verwijderd is (A→B, daarna B→C), wordt opgezocht
  in de basis; de volgende omzetting in de wachtrij brengt de instanties
  verder.
- Omdat de documenten pas bij Toepassen veranderen, telt de dialoog het
  gebruik van een type **na** de wachtrij (`gebruikNaWachtrij`): een type dat
  al omzetdoel is, geldt als in gebruik.
- **OK** = Toepassen en daarna sluiten.
- **Annuleren**, Escape en X doen `sessie.annuleren()` en daarna
  `closeDialog`. De werkkopie en de wachtrij vervallen. Registry,
  documenten, opslag en tool-selectie blijven ongewijzigd en er gaat **geen
  melding** uit. Een daarna alsnog aangeroepen Toepassen heeft niets meer om
  toe te passen.
- Toepassen zonder verschil doet geen commit en stuurt geen melding.
- **Bewerken** controleert de fysieke maten met dezelfde grenzen als het
  contract (`controleerEditorInvoer`): celmaat en strookbreedte 50–20000 mm,
  sparingsdrempels 10–20000 mm en klein ≤ raveel. Een waarde daarbuiten komt
  niet in de werkkopie; de dialoog toont de melding en zet het veld terug.
  Een leeg veld blijft toegestaan: de maat wordt onbevestigd.

### 9.3 Weergave

- In de typenlijst staat een eigenaarlabel achter de naam, bijvoorbeeld
  "(extensie nl.voorbeeld.plafondcatalogus)", aangevuld met "niet geladen"
  als dat zo is.
- Bij een geselecteerd type met een eigenaar staat een alleen-lezen regel
  "Beheerd door …; wijzigingen hier gelden als gebruikersbewerking".
- Onbevestigde maten verschijnen als een leeg veld met de placeholder
  "onbevestigd". Een veld leegmaken maakt de maat onbevestigd, en niet 600.
  `muteer` gebruikt daarvoor de nieuwe normalisatie. Bij de strook-layout
  staat naast de strookbreedte ook "Celmaat Y", want die is daar vereist.
- De knop "…" in het eigenschappenpaneel opent de editor met het type van de
  geselecteerde instance.
- Het eigenschappenpaneel toont bij een systeem met een onbevestigde
  typemaat onder "Randstukken" "onbevestigd (het type mist een maat)" en
  geen randmaten (`randstukkenVoorPaneel`): zonder indeling is er geen
  randstuk, en "— (volle plaat)" zou een bevestigde indeling suggereren.
- Het label "Typen in dit document" wordt "Systeemtypen (bibliotheek)". De
  bibliotheek geldt voor de hele app.

## 10. Meldingen

`api.onSystemTypesChanged(listener)` geeft een functie terug waarmee je je
afmeldt. Het patroon is dat van `onDocumentEvent`:

- een Set per plugin, opgeruimd in `_cleanup`;
- elke listener in een eigen try/catch, met
  `console.warn('[plugin] systemTypesChanged listener failed', error)`;
- een `listener` die geen functie is, geeft een `TypeError`.

Payload, één per commit:

```js
{
  libraryRevision: 12,
  source: 'editor' | 'properties-panel' | 'extension' | 'mcp' | 'document',
  sourceExtensionId: 'nl.voorbeeld.plafondcatalogus',   // alleen bij source 'extension'
  changes: [
    { id, change: 'added' | 'updated' | 'removed',
      revision, previousRevision,            // null bij added respectievelijk removed
      type: SystemTypeSnapshot | null },     // null bij removed
  ],
}
```

**Wanneer**: synchroon, direct na stap 1 tot en met 3 van de commit (§7). Het
event komt dus nadat de registry-state vervangen is en nadat persistentie en
redraw zijn aangevraagd. De extensie ontvangt ook de meldingen over haar
eigen registraties. Ze kan die filteren op `sourceExtensionId`.

**Volgorde**: elke listener krijgt de meldingen in de volgorde van de
commits, dus met oplopende `libraryRevision`. Een listener die zelf een
wijziging aanroept (bijvoorbeeld een extensie die op de bewerking van een
andere reageert), ziet die commit meteen doorgevoerd en krijgt de status
terug; de melding daarvan wacht in een wachtrij tot de lopende melding bij
álle listeners is afgeleverd. Zo ziet geen listener revisie n+1 vóór
revisie n, en kan een consument veilig meldingen negeren met een
`libraryRevision` die hij al gezien heeft. Elke melding beschrijft de stand
van haar eigen commit.

**Nooit** bij:

- Annuleren, sluiten zonder Toepassen, of Toepassen zonder verschil;
- de uitkomsten `unchanged`, `kept-user-edit` of `removed-by-user`;
- een afgewezen aanroep;
- een migratie tijdens het lezen;
- een PDF-snapshot met een id dat al bestaat;
- lezen, editor openen of tool kiezen.

**MCP** krijgt geen push. Een client vergelijkt bij het pollen van
`app_list_system_types` de `libraryRevision` en de `revision` per type.

## 11. Levenscyclus en deactivatie

| moment | gedrag |
|---|---|
| activate | Registreer alle catalogustypen opnieuw en bekijk de statussen. Lees de huidige stand één keer in, want listeners krijgen alleen latere wijzigingen. |
| deactivate en `_cleanup` | Alleen runtime gaat weg: de listeners van `onSystemTypesChanged`, de geladen-markering en een tool-keuze van deze extensie (§8). **Bewaarde typen blijven altijd staan**, ook als ze niet gebruikt worden. De opgeruimde api weigert daarna elke wijziging, tool-keuze, editor-opening en nieuwe listener met `disposed`; lezen kan nog. |
| extensie niet geladen | De typen blijven tekenbaar, selecteerbaar en bewerkbaar door de gebruiker. Bijwerken via de API kan pas weer als de extensie terug is (een nieuwe api na het opnieuw laden). `owner.loaded` is `false`. |
| uninstall | Gelijk aan deactivate. De typen blijven in de preferences, dus documenten en snapshots blijven werken. Dezelfde voorrang als bij pluginannotaties zonder handler (`saver.js:438-440`). |
| reinstall of herladen | unload + load. Registreren geeft `unchanged` of `kept-user-edit`, zonder duplicaten. |
| ander plugin-id | Andere namespace, dus nieuwe typen. De oude blijven bestaan als typen zonder geladen eigenaar. |
| verwijderen | Alleen de gebruiker kan verwijderen, in de editor. Een type dat in open documenten gebruikt wordt, moet eerst omgezet worden (§9.2). Een gesloten PDF brengt zijn snapshot mee en zet het type bij het laden terug. Schema 1 heeft geen verwijder-API. |

Een type waar een document naar verwijst, verdwijnt dus nooit door een
deactivatie of uninstall.

`api.getPreferences()` geeft voortaan een **losgekoppelde kopie** terug, en
niet meer het live object. De API documenteert die functie al als
alleen-lezen (`plugin-api.js:152`). Met een kopie wordt dat afdwingbaar en
verdwijnt de omweg buiten de validatie om. Er is één compatibiliteitsrisico:
een extensie die het object bewaart en verwacht dat het live meebeweegt, ziet
nu een oude stand. In deze repo gebruikt geen enkele extensie het zo.

## 12. MCP

Er komen vijf vaste host-tools. Dynamische tools per extensie zijn niet
mogelijk, want de lijst is statisch in Rust en `tools.json`. De eigenaar is
altijd de MCP-namespace `mcp:<key>`. Een MCP-client kan zich niet uitgeven
voor een extensie.

| tool | meta (`mcp_tool_meta.rs`) | kanaal | handler | timeout |
|---|---|---|---|---|
| `app_list_system_types` | `lees(…, "List system types")` | `mcp:list-system-types` | `handleListSystemTypes` | 10 s |
| `app_register_system_type` | `wijzigt(…, "Register system type")` | `mcp:register-system-type` | `handleRegisterSystemType` | 10 s |
| `app_update_system_type` | `wijzigt(…, "Update system type")` | `mcp:update-system-type` | `handleUpdateSystemType` | 10 s |
| `app_open_system_type_editor` | `lees(…, "Open system type editor")` | `mcp:open-system-type-editor` | `handleOpenSystemTypeEditor` | 10 s |
| `app_get_system_geometry` | `lees(…, "Get system geometry")` | `mcp:get-system-geometry` | `handleGetSystemGeometry` | 10 s |

`app_register_system_type` staat onder `wijzigt` (destructiveHint true): een
andere definitie vervangt een bestaand `mcp:<key>`-type dat de gebruiker niet
bewerkte, met een nieuwe revisie, en hertekent alle systemen die het
gebruiken. Dat is meer dan iets toevoegen. De client vraagt er dus om
toestemming, net als bij bijwerken.

De regels voor de argumenten komen in de pure module
`js/annotations/systeem-typen-mcp.js` (`mcpLijstSysteemTypen`,
`mcpRegistreerSysteemType`, `mcpWerkSysteemTypeBij`,
`mcpOpenSysteemTypeEditor`, `mcpSysteemGeometrie`), met hetzelfde patroon als
`annotatie-lagen-mcp.js`. De bridge geeft de registry,
`openSysteemtypenEditor` en `systeemInstanceGeometrie` mee als host:

- `controleer(args, toegestaan)` weigert onbekende argumenten met
  `unknown argument: <naam>`;
- het resultaat is `{ ok:false, code, error }` met Engelse tekst;
- er komt nooit `ok:true` zonder terug te lezen uit de registry.

Rust valideert het `inputSchema` **niet** (`mcp_server.rs:1408-1435`). JS is
dus de echte poort.

### 12.1 Schema's

De beschrijvingen hieronder zijn de letterlijke tekst. Ze moeten byte voor
byte gelijk zijn in `mcp_server.rs` en `../mcp-stdio/tools.json`.

De definitie-objecten komen uit een eigen Rust-functie,
`system_type_definition_schema(register: bool)`, vanwege de
recursielimiet van `json!` (`lib.rs:1-4`). Het verschil tussen de twee
varianten:

- `register = true`: `"required": ["naam","categorie","layout"]`, geen
  `null` op `naam`, `categorie` en `layout`;
- `register = false`: geen `required`, en de optionele velden zijn
  nullable.

```json
{
  "type": "object",
  "properties": {
    "naam":              { "type": "string", "description": "Display name (1-200 characters). Not an identity: references use the id." },
    "categorie":         { "type": "string", "enum": ["plafond", "vloer", "wand", "overig"] },
    "layout":            { "type": "string", "enum": ["raster", "strook"], "description": "raster: cells in two directions (needs celXMm and celYMm). strook: strips in one direction (needs strookBreedteMm and celYMm)." },
    "ifcCategory":       { "type": "string", "enum": ["IfcCovering", "IfcWall", "IfcSlab", "IfcPlate"] },
    "ifcPredefinedType": { "type": ["string", "null"], "enum": ["CEILING", "FLOORING", "FLOOR", "CLADDING", "ROOFING", null] },
    "celXMm":            { "type": ["number", "null"], "minimum": 50, "maximum": 20000, "description": "Cell width in mm. Left out or null: unconfirmed, no default is applied." },
    "celYMm":            { "type": ["number", "null"], "minimum": 50, "maximum": 20000, "description": "Cell height in mm. Left out or null: unconfirmed, no default is applied." },
    "strookBreedteMm":   { "type": ["number", "null"], "minimum": 50, "maximum": 20000, "description": "Strip width in mm for the strook layout. Left out or null: unconfirmed." },
    "edgeProfiel":       { "type": "string", "enum": ["geen", "hoeklijn", "schaduwvoeg"] },
    "sparingRegels":     { "type": ["object", "null"], "properties": {
                             "kleineSparingMaxMm": { "type": "number", "minimum": 10, "maximum": 20000 },
                             "raveelVanafMm":      { "type": "number", "minimum": 10, "maximum": 20000 } },
                           "additionalProperties": false },
    "paneelTypen":       { "type": "array", "minItems": 1, "maxItems": 50, "items": {
                             "type": "object",
                             "properties": {
                               "id":          { "type": "string" },
                               "naam":        { "type": "string" },
                               "renderStijl": { "type": "string", "enum": ["tegel", "ventilatie", "licht"] } },
                             "required": ["id", "naam", "renderStijl"],
                             "additionalProperties": false } },
    "lagen":             { "type": "array", "maxItems": 0, "description": "Reserved. Schema 1 has one implicit layer; only an empty array is accepted." }
  },
  "additionalProperties": false
}
```

Alle grenzen zijn gehele getallen (`50`, niet `50.0`). Dat is belangrijk
voor de gelijkheid van `tools.json` met de Rust-uitvoer.

**`app_list_system_types`**

- Description: *"List the reusable system types (suspended ceilings, floor
  slabs, panel systems) of the app library, or one type by id. Each entry
  has its stable id, owner, revision, whether the user edited it, the
  validated definition, unconfirmed dimensions and stored values that fail
  validation. Compare libraryRevision between calls to detect changes. Reads
  only."*
- Schema:
  `{ "type":"object", "properties": { "id": { "type":"string", "description":"Stable id of one system type." } }, "additionalProperties": false }`
- Resultaat: `{ ok:true, libraryRevision, types:[snapshot] }`, of met `id`
  `{ ok:true, libraryRevision, type }`. Een onbekend id geeft
  `{ ok:false, code:'not-found', error:'unknown system type: <id>' }`.

**`app_register_system_type`**

- Description: *"Register a system type owned by MCP under the id mcp:<key>.
  Repeating the call with the same definition changes nothing (status
  unchanged), and a definition the user edited in the app is kept (status
  kept-user-edit) and never overwritten. A different definition replaces an
  existing mcp:<key> type that the user has not edited (status updated) and
  redraws every system that uses it. Unknown fields, out-of-range values and
  layered definitions are rejected. Missing dimensions stay unconfirmed."*
- Schema:
  `{ "type":"object", "properties": { "key": { "type":"string", "description":"Stable key: lowercase letters, digits, dot, underscore or hyphen (1-64)." }, "definition": <definition, register=true>, "schema": { "type":"integer", "enum":[1] }, "restore": { "type":"boolean", "description":"Recreate a type the user removed. Only on an explicit user request." } }, "required": ["key","definition"], "additionalProperties": false }`
- Resultaat: `{ ok:true, status, type }`.

**`app_update_system_type`**

- Description: *"Update a system type owned by MCP (id mcp:<key>). Pass the
  revision you last read as expectedRevision; a stale revision is rejected
  with the current revision. Types of the app or of extensions cannot be
  changed here. Nested values (sparingRegels, paneelTypen) are replaced as a
  whole; null clears an optional field."*
- Schema:
  `{ "type":"object", "properties": { "id": { "type":"string" }, "expectedRevision": { "type":"integer", "minimum":1 }, "changes": <definition, register=false>, "schema": { "type":"integer", "enum":[1] } }, "required": ["id","expectedRevision","changes"], "additionalProperties": false }`
- Resultaat: `{ ok:true, status, type }`, of
  `{ ok:false, code:'stale-revision', currentRevision, error }`.

**`app_open_system_type_editor`**

- Description: *"Open the app's system type editor with the given type
  selected, or select it in the editor that is already open without
  discarding unapplied edits. Returns immediately; the user applies or
  cancels in the app. Does not change any data."*
- Schema:
  `{ "type":"object", "properties": { "id": { "type":"string", "description":"Stable id of the system type to select." } }, "required": ["id"], "additionalProperties": false }`
- Resultaat: `{ ok:true, opened, typeId }`.

**`app_get_system_geometry`**

- Description: *"Get the geometry of one system (suspended ceiling, floor
  slab, panel field) in the active document, computed by the app's own
  geometry engine: panels with clipped outlines, grid lines, openings,
  trimmers, edge segments and component positions, in millimetres in the
  system's own frame (independent of zoom and view rotation; placement maps
  it onto the page). Includes the document and type revisions and whether
  every physical dimension is confirmed. Pass expectedDocumentRevision and
  expectedTypeRevision to reject a stale snapshot. Reads only."*
- Schema:
  `{ "type":"object", "properties": { "annotationId": { "type":"string", "description":"Id of the system annotation (type systeemraster) in the active document." }, "expectedDocumentRevision": { "type":"string", "description":"document.revision of an earlier snapshot; a different current revision is rejected." }, "expectedTypeRevision": { "type":"integer", "minimum":1, "description":"type.revision of an earlier snapshot; a different current revision is rejected." }, "schema": { "type":"integer", "enum":[1] } }, "required": ["annotationId"], "additionalProperties": false }`
- Resultaat: `{ ok:true, geometry }` (de snapshot uit §12a). Geen systeem met
  dat id in het actieve document: `{ ok:false, code:'not-found', error }`.
  Een verouderde revisie: `{ ok:false, code:'stale-revision', field,
  currentRevision, error }`.

Tool-selectie via MCP is niet nodig voor #567. Het bestaande `app_set_tool`
blijft ongewijzigd; het activeert de native tool en zet hem dus op het
standaardtype (§8).

### 12.2 Bestanden die gelijk moeten blijven

- `src-tauri/src/mcp_server.rs`:
  - vijf descriptors na `facade_element_tool()` (`:1243`);
  - vijf dispatch-armen met `Duration::from_secs(10)`, onder het commentaar
    `// Systeemtypen (#567)`;
  - in de test op `:1973` gaat het aantal van 62 naar **67**;
  - de nieuwe namen in de optionele lijst van de test op `:2444`.
- `src-tauri/src/mcp_tool_meta.rs`: vijf rijen (registreren en bijwerken
  onder `wijzigt`, de andere drie onder `lees`).
- `js/mcp-bridge.js`: vijf handlers en een `HANDLERS`-groep
  `// Systeemtypen (#567)`. App-modules worden lazy geïmporteerd.
- `../mcp-stdio/tools.json`: vijf entries achteraan, met de sleutels
  alfabetisch, 2-spatie-inspringing en annotations
  `{destructiveHint, openWorldHint:false, readOnlyHint, title}`. Die gaan met
  de hand, omdat de Rust-libtests lokaal niet draaien. Ze zijn afgeleid uit de
  `json!`-literals in `mcp_server.rs` en achter de bestaande tekst gezet: het
  hele bestand opnieuw schrijven met JSON.stringify is niet byte-gelijk, want
  serde schrijft bestaande kommagetallen als `32.0`. T6 parseert dezelfde
  literals en vergelijkt ze met `tools.json`.
- `../mcpb/manifest.json`: via `node mcpb/scripts/pack.mjs --manifest`.
- `../mcp-stdio/brug.test.mjs:64`: van 62 naar 67.
- `../mcp-stdio/README.md:3` en `:52`: van 62 naar 67.

## 12a. Geometrie van een systeem-instance (punt 7)

`api.getSystemInstanceGeometry(annotationId, options?)` en
`app_get_system_geometry` geven een losgekoppelde, gevalideerde snapshot van
de geometrie van één systeem (annotatietype `systeemraster`) in het actieve
document. Ze lezen alleen: geen opslag, geen hertekenen, geen melding. Zonder
systeem met dat id geeft de plugin-API `null` en MCP `not-found`. Lezen kan
ook na deactivatie van de extensie.

### 12a.1 Eén bron

De snapshot komt uit `buildSysteemraster`, met dezelfde type-resolutie en
dezelfde tekenschaal op die plek als het tekenen (`systeemrasterBuildOpts`).
Panelen, geknipte randpanelen, rasterlijnen, sparingen, raveels,
randsegmenten en componentposities worden alleen omgerekend, nooit opnieuw
berekend. Daardoor komt de snapshot overeen met de native preview. De pure
regels staan in `js/annotations/systeem-geometrie.js` (`systeemGeometrie`,
`documentRevisie`, `controleerGeometrieOpties`); de app-kant
(`systeemInstanceGeometrie` in `js/annotations/systeem-geometrie-app.js`)
zoekt alleen de annotatie, de schaal en het type op.

### 12a.2 Assenstelsel en eenheden

- `units: 'mm'`: werkelijke millimeters, via de tekenschaal op die plek
  (schaalgebied, viewport, schaalbalk, PDF-viewport of documentschaal).
- `coordinateSpace: 'system'`: de oorsprong ligt in de minimumhoek van de
  omhullende rechthoek van de contour in de rasterruimte; x en y lopen langs
  de rasterrichtingen (bij rasterhoek 0 zoals op de pagina, y omlaag).
  Sparingen gebruiken dit stelsel al (§2.3), dus hun positie komt er
  ongewijzigd in.
- `placement` zet het stelsel terug op de pagina, in paginapunten (oorsprong
  linksboven, y omlaag):
  `pagina = origin + k · (x·cos θ − y·sin θ, x·sin θ + y·cos θ)`, met
  `origin`, `θ = angleDeg` en `k = pagePointsPerMm`.
- Zoom en weergaverotatie (`doc.scale`, `doc.viewRotation`, #200) zijn geen
  invoer: annotaties leven in paginaruimte. De coördinaten hangen er dus
  niet van af. Pagina draaien (`rotatePage`) bewerkt het document en draait
  de contour mee; dat geeft een nieuwe documentrevisie.

### 12a.3 Vorm (`SystemGeometrySnapshot`, schema 1)

```js
{
  schema: 1,
  annotationId: 'sg-1',
  document: { id, revision: 'g1-…' },      // §12a.5
  page: 1,
  type: { id, revision } | null,           // null zonder type (legacy-raster)
  units: 'mm',
  coordinateSpace: 'system',
  placement: { page, origin: { x, y }, angleDeg, pagePointsPerMm, scaleKnown },
  confirmed: true,                         // §12a.4
  unconfirmed: [],                         // bijv. ['celYMm'], ['scale']
  problems: [],                            // gebruikte typevelden die schema 1 niet doorstaan
  layout: 'raster' | 'strook',
  bounds: { width, height },               // de omhullende in het systeemstelsel
  areaMm2,                                 // oppervlakte van de contour
  contour: [{ x, y }],                     // vlakke contour (bogen in segmenten)
  grid: { origin: { x, y }, cellWidth, cellHeight },   // null voor een onbevestigde maat
  lines: { vertical: [{ x, segments: [{ from, to }] }], horizontal: [{ y, segments }] },
  panels: [{ ix, iy, panelType, renderStyle, component: { symbolId, naam? } | null,
             edge, x, y, width, height, outline: [{ x, y }] }],
  components: [{ ix, iy, symbolId, naam?, center: { x, y } }],
  strips: [{ index, x0, x1, width, length, fit }],     // strook-layout
  fitLines: [{ x, segments }],                         // pas-markering van passtroken
  openings: [{ id, x, y, width, height, regime }],     // regime: klein | verzwaard | raveel
  trimmers: [{ openingId, y, x1, x2 }],                // raveels (strook-layout)
  edges: [{ segment, profile, length, points, insetPoints }],
  edgePieces: { left, right, top, bottom } | null,    // randstukken; null zonder indeling
}
```

- `panels[].outline` is de cel geknipt op de contour (bij een volle cel de
  rechthoek zelf). Rasterlijnen stoppen op sparingen; sparingen worden niet
  van de paneelomtrek afgetrokken, ze staan apart in `openings`.
- Alle waarden zijn afgerond op 0,001 mm; de oppervlakte komt uit de
  onafgeronde contour.

### 12a.4 Bevestiging

`confirmed` is alleen `true` als geen gebruikte fysieke maat onbevestigd is
en geen gebruikte typewaarde schema 1 overtreedt. Er wordt nooit een
standaardmaat ingevuld.

- `unconfirmed` noemt: de vereiste maten van de layout die het type mist
  (`celXMm`, `celYMm`, `strookBreedteMm`); zonder type de plaatmaat van de
  instance (`plaatBreedteMm`, `plaatHoogteMm`); de sparingsdrempels
  (`sparingRegels.*`) als er sparingen zijn en ze niet bevestigd zijn (zonder
  type gelden standaardregels, die door niemand bevestigd zijn); en `scale`
  als er op die plek geen schaal bekend is (dan rekent de geometrie met de
  terugval 1:100 en is `placement.scaleKnown` false).
- `problems` noemt de gebruikte typevelden met een opgeslagen waarde buiten
  schema 1 (bijvoorbeeld `celXMm: 30`).
- Met een onbevestigde celmaat zijn er geen panelen, lijnen of stroken,
  staan `grid.cellWidth`/`cellHeight` voor de ontbrekende maat op `null` en
  is `edgePieces` `null`. Contour, oppervlakte en sparingen blijven er.

### 12a.5 Revisies en verouderde snapshots

- `document.revision` (`'g1-…'`) is een vingerafdruk van alles waar de
  geometrie van de instance van afhangt: pagina, contour met bogen,
  paneel- en rand-overrides, sparingen, rasterparameters (oorsprong,
  centreren, randconditie, rasterhoek), de plaatmaat van de instance, de
  typeverwijzing en de tekenschaal op die plek. Kleur, selectie en andere
  weergavevelden tellen niet mee. Het document heeft geen eigen
  revisieteller; deze vingerafdruk verandert precies als de geometrie-invoer
  van de instance verandert.
- `type.revision` is de `revisie` van het type (§2.1).
- `expectedDocumentRevision` (string) en `expectedTypeRevision` (geheel
  getal ≥ 1) zijn optioneel. Wijkt de huidige revisie af, dan volgt
  `stale-revision` met `field` en `currentRevision`. Zonder type is elke
  verwachte typerevisie verouderd (`currentRevision: null`). Een verouderde
  revisie levert dus nooit een (bevestigde) snapshot op.
- Een onbekende optie, een verkeerd type of `schema` ≠ 1 geeft
  `invalid-argument` of `unsupported-version`.

### 12a.6 Wat er niet in zit

Geen PDF-bytes, geen preferences, geen weergavegegevens (tag, kleuren,
lijndikte) en geen productidentiteit (§1): de snapshot beschrijft alleen de
constructiegeometrie van deze instance. Het stabiele type-id is de brug naar
de catalogus van de extensie.

## 13. Indeling van de code

| bestand | rol |
|---|---|
| `js/annotations/systeem-typen.js` (puur) | model v2, migratie 1→2, normalisatie zonder verzonnen maten, `eigenaarVanId`, `isDoorGebruikerBewerkt`, `vereisteMaten`, `onbevestigdeMaten`, `systeemTypeDefinitieGelijk`, `revisieNaGrafsteen`, `kiesToolType`, `typeInstanceVelden`, `ifcPredefinedNaLaden` |
| `js/annotations/systeem-typen-contract.js` (nieuw, puur) | `valideerDefinitie`, `typeIdVoor`, `planRegistratie`, `planBijwerking`, `publiekeSnapshot`, `planEditorToepassen`, `controleerEditorInvoer`, `gebruikNaWachtrij`, `beginSelectie`, `focusOpType`, `eigenaarLabel`, `beheerdDoorTekst`, `SysteemTypeFout` (`name 'SystemTypeError'`, `code`) |
| `js/annotations/systeem-typen-registry.js` | `commitSysteemTypen` (meldingen in volgorde via een wachtrij), `onSysteemTypenGewijzigd`, `registreerSysteemType`, `werkEigenSysteemTypeBij`, `systeemTypeSnapshot`, `alleSysteemTypeSnapshots`, `meldExtensieActief`, `isExtensieGeladen`, de tool-keuze (`zetToolSysteemType`, `getToolSysteemTypeId`, `kiesToolSysteemType`, `toolSysteemGeactiveerd`, `toolSysteemGedeactiveerd`, `wisToolSysteemTypeVanExtensie`); `updateSysteemType` en `ensureSysteemType` lopen via commit |
| `js/annotations/systeem-geometrie.js` (nieuw, puur) en `js/annotations/systeem-geometrie-app.js` (nieuw) | de geometriesnapshot (§12a) |
| `js/plugins/annotation-batch.js` | `assertSerializable` geëxporteerd voor het contract |
| `js/plugins/system-type-api.js` (nieuw) | `createSystemTypeApi(pluginId, host)`: dunne laag met een geïnjecteerde host, en `dispose()` voor `_cleanup` (daarna `disposed`); zelfde patroon als `annotation-batch.js` |
| `js/plugins/plugin-api.js` | `features.systemTypes: true`, methoden uitgespreid, `dispose` in `_cleanup`, `getPreferences` als kopie |
| `js/solid/stores/systeemtypenEditorStore.js` (nieuw) | openen en focussignaal |
| `js/solid/stores/systeemtypenEditorSessie.js` (nieuw) | de sessie van de editor (§9.2): werkkopie, controle van de maten, wachtrij, Toepassen, Annuleren, focus |
| `js/solid/components/dialogs/SysteemtypenDialog.jsx` | toont de sessie: `props.data.typeId` en focus, eigenaarlabel, onbevestigde maten, melding bij een geweigerde invoer |
| `js/tools/tools/systeemraster-tool.js` en `js/tools/manager.js` | type uit de tool-keuze, ifcCategory-bug, `onActivate`/`onDeactivate` voor de tool-sessie (§8) |
| `js/annotations/systeemraster.js` | geen cellen bij een onbevestigde maat (`geom.onbevestigd`), label "maat onbevestigd", `sparingRegelsVoorType`, geen terugval op standaard-sparingsregels als er een type is, `randstukkenVoorPaneel` |
| `js/pdf/saver.js` | `OPS_SgPlaatB/H` weglaten bij een onbevestigde maat; de snapshot krijgt metadata via de normalisatie |
| `js/pdf/loader/annotation-converter.js` | terugval op 2000 alleen zonder type; het type is leidend voor het IFC-predefined type (`ifcPredefinedNaLaden`) |
| `js/solid/stores/propertiesStore.js` en `js/solid/components/properties-panel/SysteemrasterSection.jsx` | typemaat of leeg ("onbevestigd") in het paneel, randstukken "onbevestigd", sparingsregime via `sparingRegelsVoorType`, editor openen met het type van de instance, `storeVerversSysteemType` na een commit |
| `js/annotations/systeem-typen-mcp.js` (nieuw, puur) en `js/mcp-bridge.js` | MCP |
| Rust en de stdio/mcpb-bestanden | §12.2 |

## 14. Testplan

Alles wordt eerst als test geschreven, met `node:test` in `*.test.mjs`. Elke
test komt in `scripts/unit-testlijst.txt`, niet in `package.json`. Tests die
de registry of state laden, gebruiken `js/core/app-test-hooks.mjs`, want CI
draait Node 20 en `state.ts` heeft transpilatie nodig. `preferences.js` en
`rendering.js` zijn daar stubs die aanroepen tellen in
`globalThis.__stubCalls`. Controle gaat met `npm run test:unit` en
`npx vite build` in `open-pdf-studio/`. Het oordeel volgt uit de exitcode en
de volledige uitvoer.

### 14.1 Testbestanden

| # | bestand | inhoud |
|---|---|---|
| T1 | `js/annotations/systeem-typen-contract.test.mjs` (puur) | validatie per veld uit §4.3 (onbekend, ook genest; buiten bereik zonder klemmen; enum; `null`; JSON-zuiverheid); `lagen` niet leeg geeft `unsupported-field`, `[]` mag; `schema: 2` geeft `unsupported-version`; ontbrekende maat blijft weg en staat in `unconfirmed`; namespace-grammatica (`invalid-owner`, `invalid-key`); `planRegistratie` met alle vijf statussen en `restore`; `planBijwerking` met `not-found`, `not-owner` (app, andere extensie, `mcp:`), `stale-revision` met `currentRevision`, `readonly-field` en `unchanged`; een gedeeltelijke wijziging laat opgeslagen velden staan (ook waarden buiten schema 1 en een niet-lege `lagen`), `{}` geeft `unchanged`; revisies lopen door na verwijderen en terugzetten (registratie, PDF en editor; een oude revisie geeft `stale-revision`); de grens van 50 paneeltypen geldt voor het opgeslagen assortiment; elke geaccepteerde registratie geeft een snapshot zonder `problems`; elke waarde wordt één keer gelezen (getter); atomiciteit (bij een fout dezelfde datareferentie terug); snapshot losgekoppeld (muteren raakt de bron niet); opgeslagen rommel komt in `problems` |
| T2 | `js/annotations/systeem-typen.test.mjs` (in `scripts/test-systeemraster.mjs` krijgt de fixture `KANAALPLAAT` een expliciete `celYMm`, omdat de normalisatie die niet meer invult) | migratie v1→v2 (revisie 1, onbekende velden weg, geen ruwe kortsluiting, dubbele id's); de deepEqual-rondgang van de defaults blijft slagen; vaste id's en waarden van de ingebouwde typen blijven gelijk; snapshot-JSON-rondgang met metadata; een oude v1-snapshot zonder metadata laadt met revisie 1; `ext:`-snapshot zonder `eigenaarRevisie` telt als bewerkt; `mergeSysteemType`: bestaand id wint; `buildSysteemraster` met een onbevestigde maat geeft geen cellen of stroken plus `onbevestigd`; een legacy-raster zonder type houdt 2000 × 2000; de randstukken voor het paneel zijn bij een onbevestigde maat "onbevestigd" (`randstukkenVoorPaneel`) |
| T3 | `js/annotations/systeem-typen-editor.test.mjs` (puur) | `planEditorToepassen`: alleen het diff; een type dat na het openen geregistreerd is, overleeft Toepassen; een onaangeraakt type dat intussen door een extensie is bijgewerkt, overleeft; de gebruikerswijziging wint bij overlap; verwijderen van een eigendomstype geeft een grafsteen; omzettingen alleen in het plan van Toepassen; geen verschil geeft een leeg plan; beginselectie en focusselectie inclusief het ophalen van een type dat in de werkkopie ontbreekt |
| T4 | `js/annotations/systeem-typen-registry.test.mjs` (app-test-hooks) | commit verhoogt de bibliotheekrevisie, roept `savePreferences` aan (stubteller, na `await`) en `redraw`, en stuurt precies één event met de payload uit §10; geen event bij `unchanged`, `kept-user-edit`, een afwijzing of lezen met migratie; listener-isolatie (een gooiende listener blokkeert de volgende niet); afmelden; paneelbewerking via `updateSysteemType` maakt het eigendomstype bewerkt en meldt `properties-panel`; `ensureSysteemType` met een nieuw id meldt `document`, met een bestaand id meldt hij niets; een grafsteen vervalt bij een PDF-import; een listener die zelf commit: elke listener krijgt de meldingen in volgorde; een commit ververst het paneel alleen bij één geselecteerd systeem, zonder selectiemelding, en laat een meervoudige selectie staan; de tool-keuze geldt alleen voor de activering die haar start |
| T5 | `js/plugins/system-type-api.test.mjs` (app-test-hooks) | volledige scenario's met een synthetische extensie `test.synthetisch`, zie §14.2; daarnaast: de tool-keuze vervalt bij een tool-wissel, een native activering en de deactivatie van de eigen extensie; na `dispose` geeft elke wijziging `disposed`; de geometrie van een systeem in een open document met document- en typerevisie |
| T6 | `js/annotations/systeem-typen-mcp.test.mjs` (puur plus drift) | argumentcontrole (`unknown argument`), de MCP-namespace, Engelse fouten met `code`; de geometrie via MCP (revisies, `not-found`, `stale-revision`); drift: de namen in de `HANDLERS` van `mcp-bridge.js`, de descriptors en dispatch-armen (kanaal en 10 s) in `mcp_server.rs`, de metacategorieën in `mcp_tool_meta.rs` (registreren onder `wijzigt`), de descriptions in `tools.json` byte-gelijk aan Rust, de annotations (destructiveHint), de namen in `manifest.json`, `additionalProperties:false`; dit volgt `annotatie-lagen-mcp.test.mjs:108-128` |
| T7 | `js/solid/components/dialogs/systeemtypen-dialoog-bedrading.test.mjs` (broncontrole) | de dialoog maakt één sessie met `props.data.typeId` en volgt het focussignaal; Annuleren, Escape en X gaan via `sessie.annuleren()`; de dialoog past zelf niets toe en zet niets om; de maatvelden geven een geweigerde invoer terug; de tool en `setTool` melden activeren en deactiveren; de saver en loader voor het IFC-predefined type; de randstukken in het paneel; `plugin-api.js` heeft `features.systemTypes` en roept `dispose` aan in `_cleanup` |
| T8 | `js/annotations/systeem-geometrie.test.mjs` (puur) | de geometriesnapshot (§12a): vorm en sleutels, overeenkomst met `buildSysteemraster` (panelen, lijnen, randstukken, paneeltypen), geknipte randpanelen en sparingen bij een concave contour met een gedraaid raster, plaatsing terug op de pagina, componenten, strook-layout, onbevestigde maten en schaal, legacy zonder type, document- en typerevisies (`stale-revision`), opties, losgekoppeld |
| T9 | `js/solid/stores/systeemtypenEditorSessie.test.mjs` (app-test-hooks) | de editorsessie tegen de echte registry: Toepassen (één commit, één melding, omzettingen in de documenten, `doc.modified`, opslaan), Annuleren (registry, documenten, opslag, meldingen en tool-keuze ongemoeid), een type dat na het openen geregistreerd is, focus, controle van de maten, luisteraars |
| T10 | `js/pdf/loader/systeemraster-ifc-rondgang.test.mjs` (pdf-lib) | opslaan en laden via pdf-lib en de echte `extractAnnotationColors`: een type zonder predefined type krijgt geen verzonnen `CEILING` |
| – | `../mcp-stdio/brug.test.mjs` en `../mcpb/manifest.test.mjs` (bestaand) | het aantal wordt 67 en de namenlijst klopt |

### 14.2 Acceptatiecriteria naar tests

| acceptatiecriterium (#567) | test |
|---|---|
| Een synthetische extensie registreert een type, kiest het in de native tool en ziet het in de native editor | T5: `registerSystemType` geeft `created`; daarna `selectSystemTypeForTool`, waarna `getToolSysteemTypeId()` het id is en `kiesToolType` het levert (zelfde id en `ifcCategory` van het type, de bug van regel 212); `openSystemTypeEditor` zet het focussignaal op dat id; de beginselectie en de lijst uit T3 bevatten het type met het eigenaarlabel; een tweede aanroep geeft `opened:false` met een nieuw volgnummer; T9: een sessie met dat `typeId` selecteert het type, ook als het pas na het openen geregistreerd is |
| Toepassen bewaart een wijziging en meldt die | T9 (de sessie van de dialoog: één commit, één melding met `source:'editor'`, omzettingen in de documenten, `doc.modified`, `savePreferences`) + T3 (plan) + T4 (commit) + T5 (de extensie-listener ontvangt het `updated`-event en `getSystemType` toont de nieuwe revisie met `userEdited:true`) |
| Annuleren laat registry en documenten ongewijzigd | T9: na bewerken, omzetten en verwijderen in de sessie laat `annuleren()` registry, annotaties, `doc.modified`, opslag, meldingen en tool-keuze ongemoeid, en een Toepassen daarna past niets toe; T7: Annuleren, Escape en X gaan via `sessie.annuleren()` |
| Opnieuw registreren behoudt een gebruikersbewerking en maakt geen duplicaat | T1 (`kept-user-edit`, `unchanged`) + T5 (na een editorcommit opnieuw registreren geeft `kept-user-edit`, `listSystemTypes({owned:true})` geeft precies 1; ook na `dispose` en een nieuwe api voor hetzelfde id, oftewel reinstall) |
| Onbekende of foutieve velden, updates over extensiegrenzen en verouderde revisies worden geweigerd | T1 (alle codes, ook een getter die na de controle iets anders teruggeeft en een oude revisie na verwijderen en terugzetten) + T5 (`test.ander` werkt het type van `test.synthetisch` bij en krijgt `not-owner`; een oude `expectedRevision` geeft `stale-revision`; een gedeactiveerde api krijgt `disposed`; bij elke afwijzing blijven registry en tellers gelijk) + T6 (dezelfde afwijzingen via MCP) + T9 (maten buiten het bereik in de editor) |
| Bestaande native typen en draagbare PDF-snapshots blijven werken | T2 (ingebouwde typen gelijk, rondgang van de defaults, oude en nieuwe snapshot-JSON, legacy-raster) + T4 (`ensureSysteemType`: bestaand id wint) + T10 (IFC-predefined type over opslaan en laden) + de bestaande `scripts/test-systeemraster.mjs` blijft groen |
| De geometriesnapshot komt overeen met de native preview, ook bij geknipte randen en sparingen; de coördinaten hangen niet af van zoom en weergaverotatie; onbevestigde maten en verouderde revisies geven geen bevestigde snapshot | T8 (overeenkomst met `buildSysteemraster`, geknipte omtrekken binnen cel en contour, plaatsing terug op de pagina, `confirmed:false` met `unconfirmed`, `stale-revision` voor document en type) + T5 (de snapshot via de plugin-API is gelijk na het wijzigen van `doc.scale` en `doc.viewRotation`, en volgt een Toepassen in de editor) + T6 (via MCP) |
| Deactivatie verwijdert geen type waar een document naar verwijst; levenscyclus en eigendom zijn gedocumenteerd | T5: na `dispose` (`_cleanup`) staat het type nog in de registry, `owner.loaded` is `false`, de listener wordt niet meer aangeroepen, een instance met het type rendert via `systeemrasterBuildOpts` nog met dezelfde `typeDef`, de tool-keuze van de extensie vervalt; T4: een grafsteen wordt door een PDF-import opgeheven; documentatie: dit document, §3 en §11 |

### 14.3 Uitkomst bij de bouw

- `npm run test:unit`: 3085 tests, 3081 geslaagd, 0 mislukt, 4 overgeslagen
  (vóór de bouw: 2962 tests, 0 mislukt, 4 overgeslagen).
- De nieuwe tests die app-test-hooks gebruiken, slagen ook met
  `node --test --no-experimental-strip-types` (zoals op Node 20 in CI).
- `npx vite build`: geslaagd.
- `cargo check --tests -p open-pdf-studio` (msvc, eigen target-map, niets
  gestart): geslaagd, alleen de twee waarschuwingen die er al waren
  (verouderde `Shell::open`, ontbrekende pdfium-worker-sidecar). De Rust-tests
  zelf (aantal 67, `tools.json` gelijk aan de Rust-uitvoer) zijn daarmee
  gecompileerd maar niet gedraaid; T6 controleert dezelfde gelijkheid vanuit
  JS.
- Geen wijziging aan het tekenen, de saver-uitvoer of de rotatielogica van
  pagina's: de rotatie-sweep is voor deze stap niet nodig. De loader kiest
  alleen het IFC-predefined type anders (§7, T10).

### 14.4 Handmatige controle (later, door de gebruiker)

Deze controles gebeuren niet in deze stap. Ze vragen de app of de rig, en die
worden hier niet gestart:

- een extensie installeren, een type registreren, tekenen, de editor openen,
  Toepassen en Annuleren;
- een PDF opslaan en heropenen;
- de tool-keuze: na `selectSystemTypeForTool` tekenen, daarna de native tool
  uit het lint of de bibliotheek kiezen en zien dat hij weer het
  standaardplafond tekent;
- de geometrie van een getekend systeem lezen en vergelijken met wat de app
  toont, ook na zoomen en weergave draaien;
- de vijf MCP-tools aanroepen tegen een draaiende app (de rig, nooit tegen
  poort 9223 van de geïnstalleerde app).

## 15. Bekende grenzen (buiten #567)

- Instances houden een **kopie** van `ifcCategory` en `ifcPredefinedType`,
  en de IFC-export leest die kopie (`ifc-export.js:22` en `:54`). Een
  IFC-wijziging op het type werkt pas door bij een typewissel of omzetting.
  De voorgestelde vervolgstap: bij de export het type laten winnen.
- Wijzigingen in de registry vallen buiten de undo van het document. Dat is
  ongewijzigd.
- Een oudere build normaliseert snapshots met standaardmaten (§2.3) en laat de
  metadata vallen. Een oudere build die v2-preferences leest, laat die
  ongemoeid (`v > SYSTEEMTYPE_VERSION`). Een type dat daar in de dialoog
  bewerkt wordt, verliest zijn metadata en telt daarna als revisie 1 zonder
  eigenaarrevisie, dus als bewerkt door de gebruiker.
- MCP kan niet pushen; zie §10.
- De native indeling neemt een cel op als een van haar negen meetpunten
  binnen de contour ligt (`_classifyCell`). Bij een gedraaid raster kan een
  cel die de contour alleen met een hoekpuntje raakt daardoor ontbreken, in
  de preview én in de geometriesnapshot, die de native geometrie volgt
  (§12a.1). De som van de paneelomtrekken is dan iets kleiner dan
  `areaMm2`; zonder rasterhoek is ze gelijk. Een exacte classificatie is een
  wijziging van de native geometrie en valt buiten #567.
- `document.revision` van de geometrie is een vingerafdruk van de
  geometrie-invoer van één instance, geen teller voor het hele document
  (§12a.5). Een wijziging elders in het document maakt een snapshot van deze
  instance dus niet verouderd.
- De inline bewerking van de tag (klik op "BxH" of op "maat onbevestigd")
  bewerkt nog de instance-velden `plaatBreedteMm/plaatHoogteMm`, niet het
  type. Bij een instance met type heeft dat geen effect op de tekening. Dat
  gedrag bestond al en is hier niet veranderd.

## 16. Gekoppelde systeem-instances en eigen eigenschappenformulieren (#574)

Een technische extensie wil een eigen eigenschappenformulier tonen als een
native systeem (bijvoorbeeld een plafond) geselecteerd wordt dat bij haar
hoort. Gewone native instances en andere extensies houden hun gewone
eigenschappen. Tot nu toe kon dat alleen met
`registerPropertyPanel(typeName, renderFn)`. Dat bewaart één renderer per
annotatietype: wie hem voor `systeemraster` registreert, krijgt elke
instance en vervangt stil de renderer van een andere extensie. Dit
hoofdstuk beschrijft het afgebakende contract dat daarvoor in de plaats
komt. Het sluit aan op de systeemtypen (§4) en de geometriesnapshot
(§12a).

### 16.1 Bestanden

| Bestand | Rol |
|---|---|
| `js/annotations/systeem-instance-links.js` | Puur: koppelingen normaliseren, naar en uit JSON (PDF), de instancerevisie, `kenSysteemTypeToe` (de typekeuze van het eigenschappenpaneel) en `systeemHoeveelheden`. |
| `js/plugins/system-instance-api.js` | Snapshots, koppelen, wijzigen en loskoppelen, met een geïnjecteerde host (zelfde patroon als `system-type-api.js`). |
| `js/plugins/system-instance-app.js` | De echte host: undo-stap, opnieuw tekenen, paneel verversen. |
| `js/plugins/system-instance-panels.js` | Register van de formulieren en de host van de open formulieren (Toepassen, Annuleren, opruimen). Puur, zonder DOM. |
| `js/solid/components/properties-panel/ScopedInstancePanels.jsx` | Tekent de passende formulieren onder de native secties, met Toepassen en Annuleren. |
| `js/plugins/selection-listener-registry.js` | `onAnySelectionChange`: intern, voor het paneel. |
| `js/pdf/saver.js`, `js/pdf/loader/color-extraction.js`, `js/pdf/loader/annotation-converter.js` | `OPS_SgExtLinks` opslaan en laden. |
| `js/plugins/system-instance-panels.test.mjs` | Eenheidstests (§16.9). |

### 16.2 Koppeling en eigendom

Een instance hoort bij een extensie op een van twee manieren:

- **Koppeling.** `ann.extensionLinks[<extensie-id>] = { revision, data }`.
  `data` is van de extensie: een JSON-object van hooguit 16 KB,
  bijvoorbeeld het gekozen technische projectsysteem en of de
  hoeveelheidslabels aan staan. `revision` telt per wijziging van `data`.
  Een instance kan aan hooguit 8 extensies gekoppeld zijn. De koppeling
  reist mee in de PDF als `OPS_SgExtLinks` (JSON-tekst) op het
  systeemraster-woordenboek. De loader houdt alleen geldige items over
  (`normaliseerLinks`); onzin valt stil weg.
- **Eigen type.** Een instance met een systeemtype van de extensie
  (`ext:<id>#<key>`, §3) hoort er ook bij, zonder koppeling (`ownedType`).

Productidentiteit blijft zo bij de extensie (§1): de constructie staat in
de native instance en het type, de technische keuze in de koppeling.

### 16.3 Plugin-API

```js
if (api.features?.systemInstanceLinks && api.features?.scopedPropertyPanels) {
  api.getSystemInstance(annotationId)              // snapshot | null
  api.listSystemInstances()                        // [{ annotationId, page, revision, linked, ownedType }]
  api.linkSystemInstance(annotationId, { expectedRevision, data })      // { status: 'linked'|'unchanged', instance }
  api.updateSystemInstance(annotationId, { expectedRevision, data?, systemTypeId?, showTag? })
                                                   // { status: 'updated'|'unchanged', instance }
  api.unlinkSystemInstance(annotationId, { expectedRevision })          // { status: 'unlinked'|'unchanged', instance }
  api.getSystemInstanceQuantities(annotationId, { expectedRevision? })  // §16.6
  api.registerSystemInstancePanel(descriptor)      // §16.4
  api.unregisterSystemInstancePanel(id)
}
```

Alles werkt in het actieve document, alleen op annotaties van type
`systeemraster`.

**Snapshot** (losgekoppeld; schrijven erin verandert niets):

```js
{
  schema: 1, annotationId: 'sg-1', documentId: 'doc-3', page: 1,
  revision: 'i1-…',            // instancerevisie, §16.5
  geometryRevision: 'g1-…',    // = document.revision van de geometriesnapshot (§12a.5)
  locked: false,
  native: { systemTypeId: 'st-plafond-600x600', showTag: true, ifcCategory: 'IfcCovering' },
  type: { …SystemTypeSnapshot… } | null,   // §4.2
  link: { revision: 2, data: { … } } | null,   // alleen de EIGEN koppeling
  ownedType: false,
  linkedExtensions: ['nl.voorbeeld.plafond'],  // wie gekoppeld is, zonder hun data
}
```

**Wijzigen.** `updateSystemInstance` wijzigt alleen een instance die bij de
extensie hoort: gekoppeld, of met een eigen type (anders `not-linked`). Bij
een eigen type zonder koppeling maakt eigen `data` de koppeling alsnog
(revisie 1). Wat er kan:

- `data`: de eigen data, in haar geheel vervangen (`link.revision + 1`);
- `systemTypeId`: een bestaand type of `null`. Dit volgt dezelfde regel als
  de typekeuze in het eigenschappenpaneel (`kenSysteemTypeToe`, nu door
  beide gebruikt): verwijzing, IFC-categorie en voorgedefinieerd type. Zo
  kiest een extensie een "projectsysteem" op het native type;
- `showTag`: de native tag aan of uit.

Elke wijziging die echt iets verandert, is precies één undo-stap
(`recordModify`). Daarna wordt de tekening opnieuw getekend en ververst het
eigenschappenpaneel als de instance geselecteerd is. Een wijziging zonder
verschil geeft `unchanged` en geen undo-stap.

**Foutcodes** (`SysteemTypeFout`, `code`): `invalid-argument` (onbekend
veld, verkeerd type, data geen JSON-object of groter dan 16 KB),
`no-document`, `not-found`, `stale-revision` (met `currentRevision`),
`not-linked`, `locked` (een vergrendelde instance, zoals in het native
paneel), `unknown-type`, `limit-exceeded` (8 koppelingen), `disposed` (na
`_cleanup`; lezen blijft werken) en `invalid-owner`.

### 16.4 `registerSystemInstancePanel`

```js
api.registerSystemInstancePanel({
  id: 'technisch',                      // a-z, 0-9, '-'; uniek binnen de extensie
  title: { en: 'Technical', nl: 'Technisch' },   // hooguit 60 tekens
  matches: 'linked',                    // 'linked' | 'ownedType' | 'linkedOrOwnedType' | (snapshot) => boolean
  order: 0,                             // -1000..1000, standaard 0
  render(container, ctx) {
    // ctx.instance: bevroren snapshot (§16.3) van deze extensie
    // ctx.setDraft({ data?, systemTypeId?, showTag? }) of ctx.setDraft(null)
    // ctx.getDraft(), ctx.apply(), ctx.cancel(), ctx.signal
    …
    return () => { /* opruimen */ };
  },
});
```

- **Passen.** Het formulier verschijnt alleen bij precies één
  geselecteerde systeem-instance van het actieve document waarop `matches`
  past. `linked` en `ownedType` zijn de ondersteunde markeringen (§16.2).
  Een eigen predicaat krijgt een bevroren kopie van de snapshot van de
  eigen extensie en past alleen bij `true`. Een predicaat dat gooit, past
  niet (met een waarschuwing in de console). Een gewone instance krijgt dus
  geen formulier en houdt het native paneel.
- **Plaats.** Elk passend formulier is een eigen, inklapbare sectie onder
  de native secties (na de `registerPropertyPanel`-renderer, vóór
  Acties). De extensie tekent in haar eigen `container`; de host tekent de
  titel, Toepassen en Annuleren in Windows-stijl (hoekig, standaardcursor,
  `common.apply`/`common.cancel`).
- **Conflicten** zijn bepaald en er wordt nooit iets vervangen. Passen er
  meerdere formulieren, dan krijgt elk een eigen sectie, in de volgorde
  `order`, dan extensie-id, dan paneel-id. Hetzelfde `id` twee keer binnen
  één extensie geeft `CONTRIBUTION_CONFLICT`. Het native formulier blijft
  altijd staan. Grenzen: 4 formulieren per extensie. Een fout in de
  descriptor geeft `INVALID_CONTRIBUTION`, na `_cleanup` volgt
  `EXTENSION_INACTIVE`.
- **`registerPropertyPanel` blijft** voor annotatietypen van de extensie
  zelf, met één verandering: een renderer voor een type waarvoor een andere
  extensie al een renderer heeft, geeft nu `CONTRIBUTION_CONFLICT` in plaats
  van die stil te vervangen. Dezelfde extensie mag haar eigen renderer
  opnieuw registreren, en na herladen kan de nieuwe versie hem weer
  registreren.

### 16.5 Werkversie, Toepassen en Annuleren

- Het formulier werkt op een werkversie: `ctx.setDraft(changes)` met
  `data`, `systemTypeId` en/of `showTag`. Een ander veld geeft een
  `TypeError`. Zolang er een werkversie is, zijn Toepassen en Annuleren
  aan; bij een vergrendelde instance blijft Toepassen uit.
- **Toepassen** (de knop of `ctx.apply()`) roept namens de extensie
  `updateSystemInstance` aan, met `expectedRevision` uit de snapshot van
  het formulier. Na succes is er één undo-stap, en het formulier komt
  opnieuw met de nieuwe snapshot (`render` opnieuw, de vorige
  opruimfunctie eerst).
- **Annuleren** (de knop of `ctx.cancel()`) gooit de werkversie weg en
  tekent het formulier opnieuw met de huidige waarden. Er wordt niets
  geschreven.
- **Verouderd.** Is de instance intussen elders gewijzigd (bijvoorbeeld
  via MCP, of de contour is verschoven), dan weigert Toepassen met
  `stale-revision` en verandert er niets. Het formulier komt opnieuw met
  de huidige waarden en meldt `properties:scopedPanel.stale`. Een andere
  fout laat de werkversie staan en toont
  `properties:scopedPanel.failed` met de foutmelding. Beide teksten staan
  in alle 40 talen.
- **Elders gewijzigd terwijl het formulier openstaat.** Verandert de
  instance terwijl er een werkversie is (de app meldt de selectie dan
  opnieuw, bijvoorbeeld na een wijziging via MCP of ongedaan maken), dan
  vervalt de werkversie. Het formulier komt opnieuw met de huidige waarden
  en dezelfde melding `scopedPanel.stale`. Zonder werkversie komt het
  formulier gewoon opnieuw, zonder melding.
- **Instancerevisie** (`'i1-…'`): een vingerafdruk van de geometrierevisie
  (§12a.5), het type, de tag, de vergrendeling en alle koppelingen. Elke
  wijziging die de snapshot verandert, verandert dus ook de revisie. Een
  verschuiving van de instance maakt een openstaande werkversie verouderd;
  een wijziging aan een ander object niet.
- **Ongedaan maken en opnieuw** herstellen de annotatie. De app meldt de
  selectie daarna opnieuw, dus het formulier toont de herstelde waarden.

### 16.6 Opruimen en levenscyclus

Het formulier wordt opgeruimd bij een andere selectie, bij deselecteren,
bij een meervoudige selectie, bij een tabwissel (het paneel meldt dan een
lege selectie), bij een nieuwe revisie, bij het dichtklappen of verbergen
van het paneel en bij het uitzetten of herladen van de extensie. Opruimen
betekent: de opruimfunctie van `render` draait, `ctx.signal` gaat af en
`ctx.setDraft`, `apply` en `cancel` doen daarna niets meer.

Het paneel volgt de selectie met `onAnySelectionChange`. Dat is een interne
luisteraar in `selection-listener-registry.js` die bij elke
`fireSelectionChange` meeluistert: selecteren, verversen, deselecteren en
tabwissel. Het volgt het register met `instancePanelen.abonneer`. Beide
luisteraars en de host gaan weg als het paneel verdwijnt. `_cleanup` haalt
de formulieren via de bijdragescope weg (`systemInstancePanel`) en zet de
instance-API dicht. Er blijft dus geen luisteraar van de extensie achter.
`app_list_extensions` met `includeContributions` noemt
`systemInstancePanels`.

### 16.7 Hoeveelheden

`getSystemInstanceQuantities` rekent alleen met de gedocumenteerde
geometriesnapshot (§12a.3, `systeemHoeveelheden`), nooit met een eigen kopie
van de geometrie-engine:

```js
{ schema: 1, annotationId, document: { id, revision }, type: { id, revision } | null,
  confirmed, unconfirmed, units: { area: 'm2', length: 'm' },
  area, perimeter,                                   // contour (m², m)
  panels: { total, full, edge, byType: { tegel: 22, licht: 2 } },
  components: { total, bySymbol: { … } },
  openings: { total, byRegime: { klein: 1 } },
  edges: { byProfile: { schaduwvoeg: 12.4 } },       // m per randprofiel
  strips: { total, fit } }
```

Bij een onbevestigde maat zijn er geen panelen (`total: 0`) en is
`confirmed` `false`; er wordt nooit een aantal verzonnen. Met
`expectedRevision` wordt een verouderde instance geweigerd. De
documentrevisie van de geometrie staat in `document.revision`.

### 16.8 MCP

De technische eigenschappen zijn van de extensie. Daarom levert de app geen
vaste tools voor "projectsysteem kiezen" of "labels schakelen". De
extensie publiceert die diensten zelf als gestructureerde opdrachten
(#575, `docs/extensies-mcp-en-ribbon.md` §16), met dezelfde dienstcode als
haar formulier:

| Opdracht (voorbeeld) | effect | Doet |
|---|---|---|
| `get_instance_properties` | read | `getSystemInstance` + `getSystemInstanceQuantities` |
| `apply_instance_properties` | mutate | `updateSystemInstance` met `data` |
| `select_project_system` | mutate | `updateSystemInstance` met `data` en `systemTypeId` |
| `toggle_quantity_labels` | mutate | `updateSystemInstance` met `data` (en eventueel `showTag`) |

Een agent geeft daarbij de instancerevisie mee als
`revisionContext.sourceRevision`. De handler geeft die door als
`expectedRevision`, en een verouderde revisie wordt `STALE_REVISION` (met
`currentRevision`). Een herhaling met dezelfde `idempotencyKey` maakt geen
tweede undo-stap. Er is geen DOM-automatisering en geen bestandsdialoog
nodig. De test in §16.9 doet precies dit met een synthetische extensie.

### 16.9 Tests

`js/plugins/system-instance-panels.test.mjs` (in `scripts/unit-testlijst.txt`)
controleert:

- koppelingen normaliseren, en ze door opslaan en laden halen met pdf-lib
  en de echte `extractAnnotationColors` (ook met tekens buiten ASCII);
- de bron van saver, kleurextractie en converter;
- de instancerevisie, en `kenSysteemTypeToe` als gedeelde regel met het
  eigenschappenpaneel;
- de hoeveelheden uit de echte `systeemGeometrie`, ook onbevestigd;
- losgekoppelde snapshots, zonder de data van andere extensies;
- koppelen, wijzigen en loskoppelen met revisiecontrole, native validatie
  en één undo-stap, en ongedaan maken;
- het acceptatiescenario: twee instances van hetzelfde type, waarvan één
  gekoppeld. Alleen die toont het formulier, de gewone niet. Wisselen
  tussen gekoppelde instances ververst het formulier. Deselecteren en een
  tabwissel ruimen op. Annuleren en een verouderde revisie wijzigen niets.
  Toepassen is één undo-stap, en ongedaan maken herstelt het formulier.
  Uitzetten ruimt op zonder luisteraars achter te laten;
- een wijziging elders terwijl er een werkversie openstaat (melding, geen
  melding zonder werkversie);
- conflicten en volgorde, een bevroren predicaatsnapshot en een gooiend
  predicaat, en `ownedType`;
- de plug-in-API (registreren, `_cleanup`, `EXTENSION_INACTIVE`) en
  `registerPropertyPanel` zonder stille vervanging;
- de algemene selectieluisteraar;
- de MCP-opdrachten van een synthetische extensie (lezen, projectsysteem
  kiezen, labels schakelen, herhaling, verouderde revisie, ongeldig
  argument);
- de aansluiting in het paneel, de CSS (hoekig, standaardcursor) en de
  teksten in alle 40 talen.

### 16.10 Grenzen

- Het formulier staat ónder de native secties en vervangt ze niet. Wie
  alles zelf wil tonen, heeft nog `setNativePanelVisible(false)`, maar dat
  geldt voor het hele paneel.
- Alleen `data`, `systemTypeId` en `showTag` zijn via de API te wijzigen.
  Contour, sparingen en overrides blijven van de native bewerking. De
  constructiegeometrie wijzigt een extensie dus niet buiten de native
  editor om.
- Bij een meervoudige selectie verschijnt geen formulier.
- Kopiëren of dupliceren van een gekoppelde instance neemt de koppeling
  mee, net als de andere velden van de annotatie. Een extensie die per
  instance iets unieks bewaart, controleert dat zelf
  (`listSystemInstances`).
- De opslagsleutel `OPS_SgExtLinks` is getest met pdf-lib en de echte
  kleurextractie; de volledige opslag-rondgang in de app (opslaan en
  heropenen van een document met gekoppelde instances) staat nog open.
- Een live controle in de echte app (twee instances, formulier, Toepassen,
  ongedaan maken, uitzetten) staat nog open; de tests draaien op de echte
  modules met stubs voor de app.
