//! Crashlogboek, paniekhaak en bewaking van het WebView2-renderproces.
//!
//! Naast het gewone logboek (logboek.rs) schrijft de app bij een onverwachte
//! fout een regel in `<datamap>/OpenPDFStudio/logs/crash-<datum>.log`:
//!
//! * een Rust-paniek (met bericht, plaats, draad en backtrace);
//! * een onafgevangen fout in de frontend (`window.onerror`,
//!   `unhandledrejection`, via `herstel_crashlog`);
//! * het uitvallen van een WebView2-proces (`ProcessFailed`);
//! * een vorige sessie die niet netjes is afgesloten (gemeld door de frontend).
//!
//! Er komt nooit documentinhoud in: alleen foutteksten, stapelsporen, soorten
//! en tijden. Foutteksten worden ingekort.
//!
//! Rotatie: één bestand per dag (UTC), hooguit [`MAX_BESTAND`] groot, de
//! [`BEWAAR_BESTANDEN`] nieuwste blijven staan.
//!
//! De paniekhaak vraagt de frontend daarnaast om een noodmomentopname van alle
//! documenten met niet-opgeslagen wijzigingen (zie herstel.rs) en wacht daar
//! kort op. Op de hoofddraad kan dat niet: de WebView krijgt het verzoek pas
//! als de event-loop weer draait, en die staat stil zolang de haak wacht.
//! Daar blijft het bij de laatste regelmatige momentopname.
//!
//! Valt het renderproces van het hoofdvenster weg (of reageert het niet
//! meer), dan herlaadt de app dat venster zelf (alleen bureaublad, WebView2).
//! De nieuwe frontendsessie ziet de momentopnamen van de vorige sessie van dit
//! proces als wees en biedt ze aan (js/herstel/beleid.js). Vlak voor het
//! herladen valt er niets meer te bewaren: het renderproces met het model in
//! zijn geheugen is al weg, dus de laatste regelmatige momentopname (of
//! noodmomentopname) is wat er terugkomt. Tegen een crashlus: hooguit
//! [`HERLAAD_MAX`] keer per [`HERLAAD_VENSTER_MS`]; daarna blijft het venster
//! zoals het is en meldt de frontend het bij de eerstvolgende geslaagde start.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Emitter;

/// Grootte waarboven een crashlogbestand niets meer bijkrijgt (1 MiB).
pub const MAX_BESTAND: u64 = 1024 * 1024;
/// Zoveel crashlogbestanden (dagen) blijven bewaard.
pub const BEWAAR_BESTANDEN: usize = 10;
/// Langste foutmelding of stapelspoor dat in het log komt.
pub const MAX_REGEL: usize = 16 * 1024;
/// Zo lang wacht de paniekhaak op de noodmomentopname van de frontend.
pub const NOOD_WACHTTIJD: Duration = Duration::from_secs(3);
/// Hooguit één noodverzoek per zoveel tijd: panieken die elders opgevangen
/// worden (catch_unwind rond het lezen van vreemde PDF's) mogen de app niet
/// telkens drie seconden ophouden.
pub const NOOD_TUSSENPOOS_MS: u64 = 60_000;
/// Naam van het event dat de frontend om een noodmomentopname vraagt.
pub const NOOD_EVENT: &str = "herstel-nood";
/// Hooguit zoveel automatische herlaadbeurten van het hoofdvenster ...
pub const HERLAAD_MAX: usize = 2;
/// ... binnen deze tijd (5 minuten).
pub const HERLAAD_VENSTER_MS: u64 = 5 * 60_000;
/// Wachttijd tussen de melding van WebView2 en het herladen.
pub const HERLAAD_WACHT_MS: u64 = 500;

static SCHRIJFSLOT: Mutex<()> = Mutex::new(());
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static HOOFDDRAAD: OnceLock<std::thread::ThreadId> = OnceLock::new();
static LAATSTE_NOOD_MS: AtomicU64 = AtomicU64::new(0);
static NOOD: (Mutex<u64>, Condvar) = (Mutex::new(0), Condvar::new());
/// Tijdstippen van de automatische herlaadbeurten van dit proces.
static HERLADEN: Mutex<Vec<u64>> = Mutex::new(Vec::new());
/// De grens is bereikt: niet meer automatisch herladen.
static HERLAAD_GESTOPT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// De map met crashlogs: `<datamap>/OpenPDFStudio/logs`.
pub fn crashlogmap() -> Option<PathBuf> {
    crate::datamap::lokale_datamap().map(|d| d.join("OpenPDFStudio").join("logs"))
}

pub fn nu_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Kalenderdatum (UTC) uit dagen sinds 1970-01-01 (algoritme van H. Hinnant).
pub fn datum_uit_dagen(dagen: i64) -> (i64, u32, u32) {
    let z = dagen + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `2026-10-20` (UTC).
pub fn datumtekst(ms: u64) -> String {
    let (j, m, d) = datum_uit_dagen((ms / 86_400_000) as i64);
    format!("{j:04}-{m:02}-{d:02}")
}

/// `2026-10-20T12:34:56.789Z`.
pub fn tijdtekst(ms: u64) -> String {
    let dag = ms % 86_400_000;
    format!(
        "{}T{:02}:{:02}:{:02}.{:03}Z",
        datumtekst(ms),
        dag / 3_600_000,
        (dag / 60_000) % 60,
        (dag / 1000) % 60,
        dag % 1000
    )
}

/// Bestandsnaam van het crashlog van die dag.
pub fn bestandsnaam(ms: u64) -> String {
    format!("crash-{}.log", datumtekst(ms))
}

/// Inkorten op tekens (niet midden in een UTF-8-teken).
pub fn kort(tekst: &str, max: usize) -> String {
    if tekst.len() <= max {
        return tekst.to_string();
    }
    let mut eind = max;
    while !tekst.is_char_boundary(eind) {
        eind -= 1;
    }
    format!("{}… [{} bytes cut]", &tekst[..eind], tekst.len() - eind)
}

/// Eén regel (of blok) in het crashlog van `map`; geeft het bestand terug.
pub fn schrijf_in(map: &Path, ms: u64, soort: &str, tekst: &str) -> std::io::Result<PathBuf> {
    let _slot = SCHRIJFSLOT.lock().unwrap_or_else(|e| e.into_inner());
    std::fs::create_dir_all(map)?;
    let pad = map.join(bestandsnaam(ms));
    let grootte = std::fs::metadata(&pad).map(|m| m.len()).unwrap_or(0);
    let mut bestand = std::fs::OpenOptions::new().create(true).append(true).open(&pad)?;
    if grootte >= MAX_BESTAND {
        return Ok(pad);
    }
    let soort: String = soort.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    let mut blok = format!(
        "[{}] [{}] pid={} v{}\n{}\n",
        tijdtekst(ms),
        soort,
        std::process::id(),
        env!("CARGO_PKG_VERSION"),
        kort(tekst.trim_end(), MAX_REGEL)
    );
    if grootte + blok.len() as u64 >= MAX_BESTAND {
        // Eén keer melden dat de dag vol is; staat die melding er al als
        // laatste regel, dan niets meer.
        if eindigt_met_vol(&pad) {
            return Ok(pad);
        }
        blok = format!("[{}] [log-full] further entries of this day are dropped\n", tijdtekst(ms));
    }
    bestand.write_all(blok.as_bytes())?;
    drop(bestand);
    roteer(map, BEWAAR_BESTANDEN);
    Ok(pad)
}

/// Is de laatste regel van het bestand de melding "log-full"?
fn eindigt_met_vol(pad: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(pad) else { return false };
    let lengte = f.metadata().map(|m| m.len()).unwrap_or(0);
    let staart = lengte.min(160);
    if f.seek(SeekFrom::Start(lengte - staart)).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return false;
    }
    let tekst = String::from_utf8_lossy(&buf);
    tekst.trim_end().rsplit('\n').next().map(|r| r.contains("[log-full]")).unwrap_or(false)
}

/// Alleen de `aantal` nieuwste crashlogs laten staan (de naam sorteert op datum).
pub fn roteer(map: &Path, aantal: usize) {
    let Ok(lijst) = std::fs::read_dir(map) else { return };
    let mut namen: Vec<String> = lijst
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with("crash-") && n.ends_with(".log"))
        .collect();
    namen.sort();
    if namen.len() > aantal {
        for naam in &namen[..namen.len() - aantal] {
            let _ = std::fs::remove_file(map.join(naam));
        }
    }
}

/// In het crashlog van de app schrijven; fouten negeren (best effort).
pub fn schrijf(soort: &str, tekst: &str) {
    if let Some(map) = crashlogmap() {
        if let Err(e) = schrijf_in(&map, nu_ms(), soort, tekst) {
            eprintln!("[crashlog] writing failed: {e}");
        }
    }
}

// ─── Noodmomentopname ──────────────────────────────────────────────────────

/// Bij het opzetten van de app: de handle (voor het event) en de hoofddraad.
pub fn koppel(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let _ = HOOFDDRAAD.set(std::thread::current().id());
}

/// Uitkomst van een noodverzoek, voor het log.
#[derive(Debug, PartialEq, Eq)]
pub enum NoodUitkomst {
    Bevestigd,
    TijdVerstreken,
    Overgeslagen(&'static str),
}

/// Pure regel: mag er nu een noodverzoek uit?
pub fn nood_toegestaan(nu: u64, vorige: u64, tussenpoos: u64) -> bool {
    vorige == 0 || nu.saturating_sub(vorige) >= tussenpoos
}

/// Vraag de frontend om een noodmomentopname en wacht hooguit `wachttijd`.
pub fn vraag_noodmomentopname(reden: &str, wachttijd: Duration) -> NoodUitkomst {
    if HOOFDDRAAD.get() == Some(&std::thread::current().id()) {
        return NoodUitkomst::Overgeslagen("main thread: the WebView cannot answer while it waits");
    }
    let Some(app) = APP.get() else { return NoodUitkomst::Overgeslagen("app not ready") };
    let nu = nu_ms();
    let vorige = LAATSTE_NOOD_MS.load(Ordering::Relaxed);
    if !nood_toegestaan(nu, vorige, NOOD_TUSSENPOOS_MS) {
        return NoodUitkomst::Overgeslagen("an emergency snapshot was requested less than 60 s ago");
    }
    LAATSTE_NOOD_MS.store(nu, Ordering::Relaxed);
    let (slot, signaal) = &NOOD;
    let begin = *slot.lock().unwrap_or_else(|e| e.into_inner());
    if app.emit(NOOD_EVENT, serde_json::json!({ "reden": reden })).is_err() {
        return NoodUitkomst::Overgeslagen("event could not be sent");
    }
    let wacht = slot.lock().unwrap_or_else(|e| e.into_inner());
    let (teller, _) = signaal
        .wait_timeout_while(wacht, wachttijd, |t| *t == begin)
        .unwrap_or_else(|e| e.into_inner());
    if *teller != begin { NoodUitkomst::Bevestigd } else { NoodUitkomst::TijdVerstreken }
}

/// De frontend meldt dat de noodmomentopname klaar is.
pub fn nood_klaar() {
    let (slot, signaal) = &NOOD;
    let mut teller = slot.lock().unwrap_or_else(|e| e.into_inner());
    *teller += 1;
    signaal.notify_all();
}

// ─── Herladen na een renderer-crash ────────────────────────────────────────

/// Wat te doen na een `ProcessFailed` van een WebView.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HerlaadBesluit {
    /// Herladen: het renderproces van het hoofdvenster is weg of hangt.
    Herladen,
    /// Ook herladen nodig, maar de grens tegen een crashlus is bereikt.
    Grens,
    /// Niets doen: ander venster of ander proces (GPU, hulpprocessen,
    /// browserproces: dan is er geen WebView meer om te herladen).
    NietNodig,
}

/// Pure regel: herladen na deze `ProcessFailed`-soort? `eerder` zijn de
/// tijdstippen van eerdere automatische herlaadbeurten.
pub fn herlaad_besluit(hoofdvenster: bool, soort: i32, eerder: &[u64], nu: u64, max: usize, venster_ms: u64) -> HerlaadBesluit {
    // 1 = RENDER_PROCESS_EXITED, 2 = RENDER_PROCESS_UNRESPONSIVE.
    if !hoofdvenster || !(soort == 1 || soort == 2) {
        return HerlaadBesluit::NietNodig;
    }
    let recent = eerder.iter().filter(|t| nu.saturating_sub(**t) < venster_ms).count();
    if recent >= max { HerlaadBesluit::Grens } else { HerlaadBesluit::Herladen }
}

/// Stand van het automatisch herladen, voor de frontend (herstel_info).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HerlaadStatus {
    /// Zoveel keer is het hoofdvenster in dit proces automatisch herladen.
    pub herladen: u32,
    /// De grens is bereikt; er wordt niet meer automatisch herladen.
    pub gestopt: bool,
}

pub fn herlaad_status() -> HerlaadStatus {
    let n = HERLADEN.lock().map(|v| v.len() as u32).unwrap_or(0);
    HerlaadStatus { herladen: n, gestopt: HERLAAD_GESTOPT.load(Ordering::SeqCst) }
}

/// Besluit voor een `ProcessFailed` van deze WebView en noteer het herladen.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn besluit_en_noteer(label: &str, soort: i32) -> HerlaadBesluit {
    let nu = nu_ms();
    let mut lijst = HERLADEN.lock().unwrap_or_else(|e| e.into_inner());
    let besluit = herlaad_besluit(label == "main", soort, &lijst, nu, HERLAAD_MAX, HERLAAD_VENSTER_MS);
    match besluit {
        HerlaadBesluit::Herladen => lijst.push(nu),
        HerlaadBesluit::Grens => HERLAAD_GESTOPT.store(true, Ordering::SeqCst),
        HerlaadBesluit::NietNodig => {}
    }
    besluit
}

// ─── Paniekhaak ────────────────────────────────────────────────────────────

fn paniekbericht(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(s) = info.payload().downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.clone()
    } else {
        "(no message)".to_string()
    }
}

/// Zet de paniekhaak: eerst de bestaande haak (stderr), dan het crashlog en
/// het noodverzoek. Eén keer aanroepen, aan het begin van `run()`.
pub fn installeer_paniekhaak() {
    let vorige = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        vorige(info);
        let draad = std::thread::current();
        let plaats = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "(unknown)".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();
        schrijf(
            "rust-panic",
            &format!(
                "thread '{}' panicked at {plaats}: {}\nbacktrace:\n{backtrace}",
                draad.name().unwrap_or("<unnamed>"),
                paniekbericht(info)
            ),
        );
        let uitkomst = vraag_noodmomentopname("rust-panic", NOOD_WACHTTIJD);
        let tekst = match &uitkomst {
            NoodUitkomst::Bevestigd => "emergency snapshot confirmed by the frontend".to_string(),
            NoodUitkomst::TijdVerstreken => format!("no answer from the frontend within {} s; the latest regular snapshots stay", NOOD_WACHTTIJD.as_secs()),
            NoodUitkomst::Overgeslagen(waarom) => format!("emergency snapshot skipped ({waarom}); the latest regular snapshots stay"),
        };
        eprintln!("[crashlog] {tekst}");
        schrijf("rust-panic-snapshot", &tekst);
    }));
}

// ─── WebView2-processen ────────────────────────────────────────────────────

/// Pure regel: leesbare naam van een `COREWEBVIEW2_PROCESS_FAILED_KIND`.
pub fn procesfout_naam(soort: i32) -> &'static str {
    match soort {
        0 => "browser process exited",
        1 => "render process exited",
        2 => "render process unresponsive",
        3 => "frame render process exited",
        4 => "utility process exited",
        5 => "sandbox helper process exited",
        6 => "GPU process exited",
        7 => "PPAPI plugin process exited",
        8 => "PPAPI broker process exited",
        9 => "unknown process exited",
        _ => "unknown failure",
    }
}

/// Meld uitvallende WebView2-processen van deze WebView in het crashlog.
/// wry en Tauri geven `ProcessFailed` niet door; hier rechtstreeks via COM.
#[cfg(target_os = "windows")]
pub fn bewaak_webview<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    let label = webview.label().to_string();
    let voor_herladen = webview.clone();
    let _ = webview.with_webview(move |platform| {
        // SAFETY: with_webview draait op de UI-draad van deze WebView.
        if let Err(e) = unsafe { registreer_procesfout(platform.controller(), label.clone(), voor_herladen) } {
            eprintln!("[crashlog] ProcessFailed handler for '{label}' not installed: {e}");
        }
    });
}

#[cfg(all(desktop, not(target_os = "windows")))]
pub fn bewaak_webview<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}

/// Plugin die elke WebView van de app bewaakt (hoofdvenster, printwachtrij).
/// Alleen op het bureaublad; mobiel heeft geen WebView2.
#[cfg(desktop)]
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("opds-crashlog")
        .on_webview_ready(|webview| bewaak_webview(&webview))
        .build()
}

#[cfg(target_os = "windows")]
unsafe fn registreer_procesfout<R: tauri::Runtime>(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    label: String,
    webview: tauri::Webview<R>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND,
        COREWEBVIEW2_PROCESS_FAILED_REASON,
    };
    use webview2_com::ProcessFailedEventHandler;
    use windows::core::Interface;

    let kern = controller.CoreWebView2().map_err(|e| format!("CoreWebView2: {e}"))?;
    let handler = ProcessFailedEventHandler::create(Box::new(move |_bron, args| {
        let mut soort = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
        let mut reden = COREWEBVIEW2_PROCESS_FAILED_REASON::default();
        let mut code = 0i32;
        if let Some(args) = args {
            // SAFETY: COM-aanroepen op een geldige interface, op de UI-draad.
            unsafe {
                let _ = args.ProcessFailedKind(&mut soort);
                if let Ok(args2) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                    let _ = args2.Reason(&mut reden);
                    let _ = args2.ExitCode(&mut code);
                }
            }
        }
        let tekst = format!(
            "WebView '{label}': {} (kind {}, reason {}, exit code {code}); unsaved work is in the latest snapshots",
            procesfout_naam(soort.0),
            soort.0,
            reden.0
        );
        eprintln!("[crashlog] {tekst}");
        log::error!("[crashlog] {tekst}");
        schrijf("webview-process-failed", &tekst);
        crate::herstel::meld_webview_uitval();
        // Het renderproces is al weg: er valt niets meer te bewaren. De
        // nieuwe sessie na het herladen biedt de laatste momentopnamen aan.
        match besluit_en_noteer(&label, soort.0) {
            HerlaadBesluit::Herladen => {
                let n = herlaad_status().herladen;
                let regel = format!(
                    "reloading WebView '{label}' automatically ({n} of at most {HERLAAD_MAX} per {} min)",
                    HERLAAD_VENSTER_MS / 60_000
                );
                eprintln!("[crashlog] {regel}");
                log::warn!("[crashlog] {regel}");
                schrijf("webview-reload", &regel);
                // Niet vanuit de handler zelf: even later, via Tauri.
                #[cfg(desktop)]
                {
                    let wv = webview.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(HERLAAD_WACHT_MS));
                        if let Err(e) = wv.reload() {
                            eprintln!("[crashlog] reload of '{}' failed: {e}", wv.label());
                            schrijf("webview-reload", &format!("reload of '{}' failed: {e}", wv.label()));
                        }
                    });
                }
            }
            HerlaadBesluit::Grens => {
                let regel = format!(
                    "WebView '{label}' failed again: reload limit reached ({HERLAAD_MAX} per {} min); not reloading, the window stays as it is",
                    HERLAAD_VENSTER_MS / 60_000
                );
                eprintln!("[crashlog] {regel}");
                log::error!("[crashlog] {regel}");
                schrijf("webview-reload-limit", &regel);
            }
            HerlaadBesluit::NietNodig => {}
        }
        Ok(())
    }));
    let mut token = 0i64;
    kern.add_ProcessFailed(&handler, &mut token).map_err(|e| format!("add_ProcessFailed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestMap(PathBuf);
    impl TestMap {
        fn nieuw(naam: &str) -> Self {
            let p = std::env::temp_dir().join(format!("opds-crashlog-test-{naam}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            Self(p)
        }
    }
    impl Drop for TestMap {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn datum_en_tijd_in_utc() {
        assert_eq!(datumtekst(0), "1970-01-01");
        // 2026-10-20T12:34:56.789Z
        let ms = 1_792_499_696_789;
        assert_eq!(tijdtekst(ms), "2026-10-20T12:34:56.789Z");
        assert_eq!(bestandsnaam(ms), "crash-2026-10-20.log");
        assert_eq!(datumtekst(951_782_400_000), "2000-02-29");
    }

    #[test]
    fn inkorten_breekt_geen_teken() {
        assert_eq!(kort("abc", 10), "abc");
        let k = kort("ééééé", 3);
        assert!(k.starts_with('é'));
        assert!(k.contains("bytes cut"));
    }

    #[test]
    fn schrijft_en_roteert() {
        let map = TestMap::nieuw("roteer");
        let dag = 86_400_000u64;
        for i in 0..(BEWAAR_BESTANDEN as u64 + 3) {
            schrijf_in(&map.0, 1_792_499_696_789 + i * dag, "js-error", "TypeError: x is undefined").unwrap();
        }
        let mut namen: Vec<String> = std::fs::read_dir(&map.0).unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        namen.sort();
        assert_eq!(namen.len(), BEWAAR_BESTANDEN);
        assert_eq!(namen[0], "crash-2026-10-23.log");
        let inhoud = std::fs::read_to_string(map.0.join(namen.last().unwrap())).unwrap();
        assert!(inhoud.contains("[js-error]"));
        assert!(inhoud.contains("TypeError: x is undefined"));
    }

    #[test]
    fn vol_bestand_krijgt_niets_meer_bij() {
        let map = TestMap::nieuw("vol");
        let ms = 1_792_499_696_789;
        let groot = "x".repeat(MAX_REGEL);
        for _ in 0..200 {
            schrijf_in(&map.0, ms, "js-error", &groot).unwrap();
        }
        let grootte = std::fs::metadata(map.0.join(bestandsnaam(ms))).unwrap().len();
        assert!(grootte <= MAX_BESTAND + 200, "grootte {grootte}");
        let inhoud = std::fs::read_to_string(map.0.join(bestandsnaam(ms))).unwrap();
        assert_eq!(inhoud.matches("[log-full]").count(), 1);
    }

    #[test]
    fn noodverzoek_hooguit_eens_per_tussenpoos() {
        assert!(nood_toegestaan(1_000, 0, NOOD_TUSSENPOOS_MS));
        assert!(!nood_toegestaan(30_000, 1_000, NOOD_TUSSENPOOS_MS));
        assert!(nood_toegestaan(61_000, 1_000, NOOD_TUSSENPOOS_MS));
    }

    #[test]
    fn herladen_alleen_hoofdvenster_en_renderer() {
        let n = 1_000_000;
        assert_eq!(herlaad_besluit(true, 1, &[], n, 2, HERLAAD_VENSTER_MS), HerlaadBesluit::Herladen);
        assert_eq!(herlaad_besluit(true, 2, &[], n, 2, HERLAAD_VENSTER_MS), HerlaadBesluit::Herladen, "unresponsive");
        assert_eq!(herlaad_besluit(false, 1, &[], n, 2, HERLAAD_VENSTER_MS), HerlaadBesluit::NietNodig, "other window");
        for soort in [0, 3, 4, 5, 6, 9] {
            assert_eq!(herlaad_besluit(true, soort, &[], n, 2, HERLAAD_VENSTER_MS), HerlaadBesluit::NietNodig, "kind {soort}");
        }
    }

    #[test]
    fn herladen_hooguit_twee_keer_per_vijf_minuten() {
        let v = HERLAAD_VENSTER_MS;
        let t0 = 10_000_000u64;
        // Drie crashes kort na elkaar: twee keer herladen, dan de grens.
        let mut eerder = Vec::new();
        let mut uit = Vec::new();
        for i in 0..3u64 {
            let nu = t0 + i * 20_000;
            let b = herlaad_besluit(true, 1, &eerder, nu, HERLAAD_MAX, v);
            if b == HerlaadBesluit::Herladen {
                eerder.push(nu);
            }
            uit.push(b);
        }
        assert_eq!(uit, vec![HerlaadBesluit::Herladen, HerlaadBesluit::Herladen, HerlaadBesluit::Grens]);
        // Na vijf minuten telt de oudste niet meer mee.
        assert_eq!(herlaad_besluit(true, 1, &eerder, t0 + v, HERLAAD_MAX, v), HerlaadBesluit::Herladen);
        assert_eq!(herlaad_besluit(true, 1, &eerder, t0 + v - 1, HERLAAD_MAX, v), HerlaadBesluit::Grens);
    }

    #[test]
    fn procesfout_namen() {
        assert_eq!(procesfout_naam(1), "render process exited");
        assert_eq!(procesfout_naam(0), "browser process exited");
        assert_eq!(procesfout_naam(42), "unknown failure");
    }
}
