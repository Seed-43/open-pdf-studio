# Renderdiagnostiek (#677)

De normale Tauri-invoke-route observeert hele PDFium-pagina's, regio's en de
eigen Rust-schermrenderer. Een afgewezen aanvraag wordt een gestructureerde
bevinding; een ongeldige RGBA-response wordt geweigerd voordat de caller pixels
kan publiceren. Codes bevatten geen willekeurige backendfouttekst of PDF-inhoud.

De statusbalk toont het aantal bevindingen. Klikken navigeert door de betrokken
pagina's en toont de code met hersteladvies. Plugins lezen dezelfde snapshot via
`getDocumentInfo().renderDiagnostics`; MCP via `app_get_viewport_state` onder
`renderDiagnostics`. Er is geen nieuw toolnummer of wijzigend MCP-commando.

De snapshot bevat `fidelity: not-certified`, een expliciete dekkingsbeschrijving
en per pagina backend, kwaliteit en bevindingen. De native aanroep vertelt niet
of het een preview of definitieve render is: kwaliteit blijft dus `unknown`.
Een geslaagde fallback verwijdert eerdere fouten niet. Cachegebruik bewaart de
bevindingen; pagina-/documentinvalidatie verwijdert ze en verhindert late updates
uit een vorige generatie. Opslag is begrensd op 128 documenten, 1024 pagina's per
document en 16 verschillende bevindingen per pagina. Evictie impliceert geen
foutvrij document.

## Nog niet afgedekt

De bestaande backends leveren geen volledige lijst met stil overgeslagen
resources. De UI meldt daarom geen gecertificeerde volledigheid. PDF.js-browser-
decoderwaarschuwingen, verborgen native fallbackfouten en precieze object/regio-
locaties vragen aanvullende backendinstrumentatie. Er is geen globale console-
interceptie: die zou fouten niet betrouwbaar aan een document toewijzen.

De tests dekken geweigerde buffers, budgetfouten, herstel/fallback, preview/final-
provenance, cachebehoud en verouderde async-meldingen. Een synthetisch gemelde
`incomplete`-status test het contract, niet een werkelijke backenddecoder. #677
blijft open voor decoderfixtures en het melden van stille weglatingen.
