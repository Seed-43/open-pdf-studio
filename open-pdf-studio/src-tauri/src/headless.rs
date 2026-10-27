//! Headless modus voor testinstanties (`OPDS_HEADLESS=1`).
//!
//! Releasepoorten, sweeps en metingen starten een eigen testinstantie van de
//! app (`--mcp-server --mcp-port <p>`, `OPDS_DETACHED=1`, eigen
//! `OPDS_DATA_DIR`/`WEBVIEW2_USER_DATA_FOLDER`, CDP via
//! `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>`).
//! Zonder deze modus verschijnt dat venster op het scherm van de gebruiker en
//! pakt het de focus. Met `OPDS_HEADLESS=1` komt het venster nooit in beeld:
//!
//! * **Vóór het aanmaken** (`pas_context_aan`): het venster uit
//!   tauri.conf.json start onzichtbaar, zonder focus, niet-activeerbaar
//!   (`WS_EX_NOACTIVATE`), zonder taakbalkknop en met een vaste binnenmaat
//!   (`OPDS_HEADLESS_SIZE=BxH`, standaard 1200x800).
//! * **Parkeren** (`plugin`): zodra een venster bestaat wordt het, nog
//!   onzichtbaar, buiten elke monitor gezet en pas dan getoond zonder te
//!   activeren (`SW_SHOWNOACTIVATE`). Een zichtbaar venster buiten beeld blijft
//!   renderen; een verborgen venster niet. Schuift Windows het venster terug in
//!   beeld (bv. na het wisselen van monitoren), dan parkeert de plugin het
//!   opnieuw.
//! * **Browserargumenten** (`bereid_omgeving_voor`): WebView2 krijgt
//!   `--disable-features=CalculateNativeWinOcclusion` en de vlaggen tegen
//!   afknijpen van achtergrondvensters, samengevoegd met een bestaande
//!   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (de debugpoort blijft staan).
//! * **Geen native dialogen** (`dialoog_plugin`): in plaats van
//!   tauri-plugin-dialog draait een vervanger met dezelfde naam en commando's
//!   die elk venster weigert met een logregel (bestandskiezers geven `null`,
//!   berichtvensters het antwoord van wegklikken). `alert`, `confirm`,
//!   `prompt` en `print` in de WebView worden ook stil geweigerd.
//! * **Geen focus of activering**: alle code die het venster toont, focust of
//!   herstelt (single-instance, PrtScn, geopende bestanden, JS) slaat dat over
//!   via `actief()`; commando's die een ander programma naar voren halen
//!   (browser, Verkenner, mailprogramma, Windows-instellingen,
//!   printereigenschappen) weigeren via `weiger()`.
//!
//! Alleen een testinstantie telt (`--mcp-server` of `OPDS_DETACHED=1`): een
//! gewone start negeert `OPDS_HEADLESS` en gedraagt zich ongewijzigd. Een
//! losgemaakt tabblad (tweede instantie, window_mgmt.rs) erft de omgeving en
//! start dus ook headless; vensters die de app zelf opent (printwachtrij)
//! volgen via `plugin`.

mod regels;

pub use regels::{browser_args, dialoog_antwoord, is_actief, parkeerpositie, snijdt_een_monitor, venstergrootte, Rechthoek};

use std::sync::OnceLock;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, PhysicalPosition, RunEvent, Runtime, Window, WindowEvent};

/// Omgevingsvariabele die de modus aanzet.
pub const VAR: &str = "OPDS_HEADLESS";
/// Omgevingsvariabele met de binnenmaat (`BxH`).
pub const VAR_GROOTTE: &str = "OPDS_HEADLESS_SIZE";
/// WebView2 leest deze variabele bij het aanmaken van de omgeving.
pub const VAR_BROWSER_ARGS: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

static ACTIEF: OnceLock<bool> = OnceLock::new();

/// Stel één keer vast of dit proces headless draait. Aanroepen aan het begin
/// van `run()`, vóór er een venster of draad bestaat.
pub fn init(mcp_server: bool) -> bool {
    *ACTIEF.get_or_init(|| {
        is_actief(
            std::env::var(VAR).ok().as_deref(),
            std::env::var("OPDS_DETACHED").ok().as_deref(),
            mcp_server,
        )
    })
}

/// Draait dit proces headless? `false` zolang `init` niet gedraaid heeft.
pub fn actief() -> bool {
    ACTIEF.get().copied().unwrap_or(false)
}

/// Meld een onderdrukte handeling in stderr en het logboek.
pub fn meld(wat: &str) {
    eprintln!("[headless] {wat} suppressed");
    log::warn!("[headless] {wat} suppressed");
}

/// Voor commando's die een ander venster of programma naar voren halen:
/// headless een fout met een logregel, anders `Ok(())` (ongewijzigd gedrag).
pub fn weiger(wat: &str) -> Result<(), String> {
    if actief() {
        meld(wat);
        Err(format!("{wat} is not available in headless mode (OPDS_HEADLESS=1)"))
    } else {
        Ok(())
    }
}

/// Zet de samengevoegde browserargumenten in de omgeving van dit proces (en
/// daarmee ook van een losgemaakt tabblad) en geef ze terug. WebView2 geeft de
/// omgevingsvariabele voorrang boven de opties van de app; `pas_context_aan`
/// zet daarom dezelfde tekst ook in de vensterconfiguratie.
pub fn bereid_omgeving_voor() -> String {
    let args = browser_args(std::env::var(VAR_BROWSER_ARGS).ok().as_deref());
    std::env::set_var(VAR_BROWSER_ARGS, &args);
    args
}

/// Pas de vensters uit de configuratie aan vóór ze aangemaakt worden.
pub fn pas_context_aan<R: Runtime>(context: &mut tauri::Context<R>, browser_args: &str) {
    let (breedte, hoogte) = venstergrootte(std::env::var(VAR_GROOTTE).ok().as_deref());
    for venster in context.config_mut().app.windows.iter_mut() {
        pas_venster_aan(venster, breedte, hoogte, browser_args);
    }
}

/// De instellingen van één headless venster.
pub fn pas_venster_aan(
    venster: &mut tauri::utils::config::WindowConfig,
    breedte: u32,
    hoogte: u32,
    browser_args: &str,
) {
    // Onzichtbaar aanmaken: de plugin parkeert het venster eerst buiten beeld
    // en toont het daarna (een positie buiten elke monitor negeert Windows bij
    // het aanmaken, dus dat kan niet via x/y in de configuratie).
    venster.visible = false;
    venster.focus = false;
    venster.focusable = false;
    venster.skip_taskbar = true;
    venster.always_on_top = false;
    venster.maximized = false;
    venster.fullscreen = false;
    venster.center = false;
    venster.x = None;
    venster.y = None;
    venster.prevent_overflow = None;
    venster.width = breedte as f64;
    venster.height = hoogte as f64;
    venster.additional_browser_args = Some(browser_args.to_string());
}

/// Script in elke WebView van een headless instantie: markeert de modus voor
/// de frontend (`js/core/headless.js`) en weigert de vensters van de WebView
/// zelf. tauri-plugin-dialog vervangt `alert`/`confirm` normaal door native
/// vensters; die plugin draait headless niet.
const INIT_SCRIPT: &str = r#"
(function () {
  if (window.__OPDS_HEADLESS__ === true) return;
  Object.defineProperty(window, '__OPDS_HEADLESS__', { value: true });
  function meld(wat, tekst) {
    try {
      console.warn('[headless] ' + wat + ' suppressed' + (tekst == null ? '' : ': ' + String(tekst).slice(0, 200)));
    } catch (_) {}
  }
  window.alert = function (tekst) { meld('alert', tekst); };
  window.confirm = function (tekst) { meld('confirm', tekst); return false; };
  window.prompt = function (tekst) { meld('prompt', tekst); return null; };
  window.print = function () { meld('print'); };
})();
"#;

/// Plugin van de headless modus: init-script, vensters parkeren en
/// terugparkeren. Alleen registreren als `actief()`.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("opds-headless")
        .js_init_script(INIT_SCRIPT)
        .on_window_ready(|venster| {
            // Eigen draad: de vensteraanroepen hieronder gaan via de event
            // loop en mogen niet wachten op de aanroep die dit venster maakt.
            std::thread::spawn(move || parkeer_en_toon(&venster));
        })
        .on_event(|app, event| {
            if let RunEvent::WindowEvent { label, event, .. } = event {
                match event {
                    WindowEvent::Moved(positie) => {
                        if let Some(venster) = app.get_webview_window(label).map(|w| w.as_ref().window()) {
                            if in_beeld(&venster, *positie) {
                                eprintln!("[headless] window '{label}' moved on screen; parking it again");
                                std::thread::spawn(move || {
                                    if let Err(e) = parkeer(&venster) {
                                        eprintln!("[headless] parking '{}' failed: {e}", venster.label());
                                    }
                                });
                            }
                        }
                    }
                    WindowEvent::Focused(true) => {
                        eprintln!("[headless] WARNING: window '{label}' received focus");
                        log::warn!("[headless] window '{label}' received focus");
                    }
                    _ => {}
                }
            }
        })
        .build()
}

fn monitorrechthoeken<R: Runtime>(venster: &Window<R>) -> tauri::Result<(Vec<Rechthoek>, Option<usize>)> {
    let monitoren = venster.available_monitors()?;
    let hoofd = venster.primary_monitor()?;
    let rechthoeken: Vec<Rechthoek> = monitoren
        .iter()
        .map(|m| Rechthoek::new(m.position().x, m.position().y, m.size().width as i32, m.size().height as i32))
        .collect();
    let hoofd_idx = hoofd.and_then(|h| {
        monitoren
            .iter()
            .position(|m| m.position() == h.position() && m.size() == h.size())
    });
    Ok((rechthoeken, hoofd_idx))
}

fn in_beeld<R: Runtime>(venster: &Window<R>, positie: PhysicalPosition<i32>) -> bool {
    let (Ok((monitoren, _)), Ok(maat)) = (monitorrechthoeken(venster), venster.outer_size()) else {
        return false;
    };
    let r = Rechthoek::new(positie.x, positie.y, maat.width as i32, maat.height as i32);
    snijdt_een_monitor(&r, &monitoren)
}

/// Zet het venster buiten elke monitor; geeft de nieuwe positie terug.
fn parkeer<R: Runtime>(venster: &Window<R>) -> tauri::Result<(i32, i32)> {
    let (monitoren, hoofd) = monitorrechthoeken(venster)?;
    let maat = venster.outer_size()?;
    let (x, y) = parkeerpositie(&monitoren, hoofd, maat.width as i32, maat.height as i32);
    venster.set_position(PhysicalPosition::new(x, y))?;
    Ok((x, y))
}

fn parkeer_en_toon<R: Runtime>(venster: &Window<R>) {
    match parkeer(venster) {
        Ok((x, y)) => eprintln!("[headless] window '{}' parked at {x},{y}", venster.label()),
        Err(e) => {
            // Niet tonen: een onzichtbaar venster is beter dan een venster in beeld.
            eprintln!("[headless] parking '{}' failed, window stays hidden: {e}", venster.label());
            return;
        }
    }
    // Het venster is aangemaakt zonder focus: de eerste keer tonen gebeurt
    // zonder activeren (SW_SHOWNOACTIVATE).
    if let Err(e) = venster.show() {
        eprintln!("[headless] showing '{}' failed: {e}", venster.label());
    }
    // De taakbalk voegt bij het tonen soms alsnog een knop toe; nogmaals weghalen.
    #[cfg(desktop)]
    let _ = venster.set_skip_taskbar(true);
}

/// Vervanger van tauri-plugin-dialog voor headless instanties: zelfde naam en
/// commando's (dus dezelfde rechten), maar zonder venster.
pub fn dialoog_plugin<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("dialog")
        .invoke_handler(tauri::generate_handler![dialoog::open, dialoog::save, dialoog::message])
        .build()
}

mod dialoog {
    use serde_json::Value;

    fn knoppen_soort(knoppen: &Option<Value>) -> Option<String> {
        match knoppen {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Object(o)) => o.keys().next().cloned(),
            Some(_) => Some(String::new()),
        }
    }

    fn kort(tekst: &str) -> String {
        tekst.chars().take(200).collect()
    }

    #[tauri::command]
    pub async fn open(options: Option<Value>) -> Option<String> {
        let titel = options.as_ref().and_then(|o| o.get("title")).and_then(Value::as_str).unwrap_or("");
        super::meld(&format!("file open dialog '{}' (answered: cancel)", kort(titel)));
        None
    }

    #[tauri::command]
    pub async fn save(options: Option<Value>) -> Option<String> {
        let titel = options.as_ref().and_then(|o| o.get("title")).and_then(Value::as_str).unwrap_or("");
        super::meld(&format!("file save dialog '{}' (answered: cancel)", kort(titel)));
        None
    }

    #[tauri::command]
    pub async fn message(
        message: Option<String>,
        title: Option<String>,
        buttons: Option<Value>,
    ) -> &'static str {
        let antwoord = super::dialoog_antwoord(knoppen_soort(&buttons).as_deref());
        super::meld(&format!(
            "message dialog '{}': '{}' (answered: {antwoord})",
            kort(title.as_deref().unwrap_or("")),
            kort(message.as_deref().unwrap_or(""))
        ));
        antwoord
    }
}
