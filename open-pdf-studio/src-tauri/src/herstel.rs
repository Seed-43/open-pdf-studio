//! Herstel van niet-opgeslagen werk na een crash (bestanden en processen).
//!
//! De frontend (js/herstel/) beslist wat er bewaard, aangeboden en opgeruimd
//! wordt; deze module levert de bouwstenen en houdt alles binnen één map:
//!
//! ```text
//! <datamap>/OpenPDFStudio/herstel/
//!   markers/<instantie>.json      "deze instantie draait" (start → schoon afsluiten)
//!   <sleutel>/manifest.json       per document: origineel, titel, tijd, ...
//!   <sleutel>/momentopname-<n>.pdf  de laatste momentopname van dat document
//!   <sleutel>/claim               welke instantie het herstelaanbod toont
//! ```
//!
//! Een instantie is een proces, herkenbaar aan pid én starttijd (een pid kan
//! na het stoppen van een proces opnieuw uitgedeeld worden). Alles wat een
//! instantie schrijft, draagt haar id; een andere instantie raakt het niet aan
//! zolang het proces leeft. Zo zitten losgemaakte tabbladen (tweede instantie)
//! en testinstanties (`OPDS_DETACHED`) elkaar niet in de weg.
//!
//! Het origineel van de gebruiker wordt hier nooit beschreven: een half
//! geschreven bestand tijdens een crash zou het origineel vernielen.
//! Momentopnamen staan alleen in deze map en worden atomisch geschreven
//! (tijdelijk bestand + hernoemen, atomic_file.rs).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri_plugin_fs::FsExt;

use crate::crashlog;

/// Naam van de herstelmap onder `<datamap>/OpenPDFStudio`.
pub const MAPNAAM: &str = "herstel";
/// Submap met de "draait"-markeringen.
pub const MARKERMAP: &str = "markers";
/// Omgevingsvariabele die het testcommando `herstel_test_paniek` vrijgeeft.
pub const TEST_VAR: &str = "OPDS_CRASH_TEST";

static SCHOON: AtomicBool = AtomicBool::new(false);
static WEBVIEW_UITGEVALLEN: AtomicBool = AtomicBool::new(false);
static INSTANTIE: OnceLock<Instantie> = OnceLock::new();

/// `<datamap>/OpenPDFStudio/herstel`.
pub fn herstelmap() -> Option<PathBuf> {
    crate::datamap::lokale_datamap().map(|d| d.join("OpenPDFStudio").join(MAPNAAM))
}

fn map() -> Result<PathBuf, String> {
    herstelmap().ok_or_else(|| "no data directory".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Instantie {
    /// `<pid>-<starttijd in ms>`.
    pub id: String,
    pub pid: u32,
    /// Starttijd van het proces (Unix-ms).
    pub gestart_ms: u64,
}

/// Deze instantie (vastgesteld bij het eerste gebruik).
pub fn instantie() -> &'static Instantie {
    INSTANTIE.get_or_init(|| {
        let pid = std::process::id();
        let gestart_ms = proces_starttijd_ms(pid).unwrap_or_else(crashlog::nu_ms);
        Instantie { id: format!("{pid}-{gestart_ms}"), pid, gestart_ms }
    })
}

/// Pure regel: een relatief pad binnen de herstelmap. Alleen namen met
/// letters, cijfers, `-`, `_` en `.`, geen naam die met een punt begint (dus
/// geen `..` en geen tijdelijke bestanden van atomic_file), geen absolute
/// paden.
pub fn veilig_relatief(rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.len() > 400 {
        return Err("invalid recovery path".to_string());
    }
    let mut pad = PathBuf::new();
    for deel in rel.split('/') {
        let geldig = !deel.is_empty()
            && !deel.starts_with('.')
            && deel.len() <= 160
            && deel.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
        if !geldig {
            return Err(format!("invalid recovery path component '{deel}'"));
        }
        pad.push(deel);
    }
    Ok(pad)
}

fn binnen(rel: &str) -> Result<PathBuf, String> {
    Ok(map()?.join(veilig_relatief(rel)?))
}

// ─── Processen ─────────────────────────────────────────────────────────────

/// Starttijd (Unix-ms) van een LEVEND proces, `None` als het niet (meer) bestaat.
#[cfg(target_os = "windows")]
pub fn proces_starttijd_ms(pid: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const STILL_ACTIVE: u32 = 259;
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let leeg = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut start, mut eind, mut kern, mut gebruiker) = (leeg, leeg, leeg, leeg);
        let mut code = 0u32;
        let tijden = GetProcessTimes(h, &mut start, &mut eind, &mut kern, &mut gebruiker) != 0;
        let status = GetExitCodeProcess(h, &mut code) != 0;
        CloseHandle(h);
        if !tijden || !status || code != STILL_ACTIVE {
            return None;
        }
        let ticks = ((start.dwHighDateTime as u64) << 32) | start.dwLowDateTime as u64;
        // FILETIME telt in 100 ns sinds 1601-01-01.
        Some(ticks.saturating_sub(116_444_736_000_000_000) / 10_000)
    }
}

/// Buiten Windows: alleen of het proces bestaat; de starttijd van dit proces
/// is het moment van het eerste gebruik (een pid kan daar hergebruikt worden).
#[cfg(not(target_os = "windows"))]
pub fn proces_starttijd_ms(pid: u32) -> Option<u64> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let bestaat = Path::new(&format!("/proc/{pid}")).exists();
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let bestaat = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !bestaat {
        return None;
    }
    if pid == std::process::id() {
        return INSTANTIE.get().map(|i| i.gestart_ms).or(Some(0));
    }
    Some(0)
}

/// Pure regel: is dit het proces met die starttijd? Een starttijd 0 (onbekend)
/// telt als passend; anders hooguit een seconde verschil.
pub fn starttijd_past(gemeten: Option<u64>, verwacht: u64) -> bool {
    match gemeten {
        None => false,
        Some(0) => true,
        Some(t) => verwacht == 0 || t.abs_diff(verwacht) <= 1000,
    }
}

/// Leeft de instantie met dit pid en deze starttijd nog?
pub fn proces_leeft(pid: u32, gestart_ms: u64) -> bool {
    if pid == 0 {
        return false;
    }
    if pid == std::process::id() {
        return gestart_ms == 0 || gestart_ms == instantie().gestart_ms;
    }
    starttijd_past(proces_starttijd_ms(pid), gestart_ms)
}

// ─── Markering "deze instantie draait" ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    pub pid: u32,
    pub gestart_ms: u64,
    pub versie: String,
    #[serde(default)]
    pub tweede: bool,
    #[serde(default)]
    pub headless: bool,
}

fn markerpad(map: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(map.join(MARKERMAP).join(veilig_relatief(&format!("{id}.json"))?))
}

/// Schrijf de markering van deze instantie in `map`.
pub fn schrijf_marker_in(map: &Path, marker: &Marker) -> Result<PathBuf, String> {
    let pad = markerpad(map, &marker.id)?;
    if let Some(ouder) = pad.parent() {
        std::fs::create_dir_all(ouder).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(marker).map_err(|e| e.to_string())?;
    crate::atomic_file::write(&pad, &json).map_err(|e| e.to_string())?;
    Ok(pad)
}

/// Bij de start: markering schrijven. Fouten zijn niet fataal.
pub fn start(tweede: bool) {
    let Some(map) = herstelmap() else { return };
    let i = instantie();
    let marker = Marker {
        id: i.id.clone(),
        pid: i.pid,
        gestart_ms: i.gestart_ms,
        versie: env!("CARGO_PKG_VERSION").to_string(),
        tweede,
        headless: crate::headless::actief(),
    };
    match schrijf_marker_in(&map, &marker) {
        Ok(pad) => eprintln!("[herstel] running marker {}", pad.display()),
        Err(e) => eprintln!("[herstel] running marker not written: {e}"),
    }
}

/// Pure regel: mag de markering bij het afsluiten weg? Alleen als de frontend
/// netjes heeft afgesloten (alle documenten opgeslagen of bewust verworpen).
/// Bleef de markering staan, dan ziet de volgende start een onverwachte
/// afsluiting.
pub fn marker_weg_bij_afsluiten(schoon: bool, webview_uitgevallen: bool) -> bool {
    schoon && !webview_uitgevallen
}

/// Bij `RunEvent::Exit`.
pub fn bij_afsluiten() {
    let schoon = SCHOON.load(Ordering::SeqCst);
    let uitgevallen = WEBVIEW_UITGEVALLEN.load(Ordering::SeqCst);
    if !marker_weg_bij_afsluiten(schoon, uitgevallen) {
        eprintln!("[herstel] exit without a clean frontend shutdown; running marker stays");
        return;
    }
    if let Some(map) = herstelmap() {
        if let Ok(pad) = markerpad(&map, &instantie().id) {
            let _ = std::fs::remove_file(pad);
        }
    }
}

/// crashlog.rs meldt een uitgevallen WebView2-proces.
pub fn meld_webview_uitval() {
    WEBVIEW_UITGEVALLEN.store(true, Ordering::SeqCst);
}

// ─── Claim op een aanbod ───────────────────────────────────────────────────

/// Pure regel: mag deze instantie een map claimen die al een claim heeft?
pub fn claim_overnemen(bestaande: Option<&Instantie>, eigen: &Instantie, leeft: impl Fn(&Instantie) -> bool) -> bool {
    match bestaande {
        None => true,
        Some(b) if b.id == eigen.id => true,
        Some(b) => !leeft(b),
    }
}

/// Claim een momentopnamemap voor het herstelaanbod van deze instantie, zodat
/// twee instanties die tegelijk starten niet hetzelfde document aanbieden.
pub fn claim_in(map: &Path, eigen: &Instantie) -> Result<bool, String> {
    let pad = map.join("claim");
    let json = serde_json::to_vec(eigen).map_err(|e| e.to_string())?;
    for _ in 0..2 {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&pad) {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(&json).map_err(|e| e.to_string())?;
                return Ok(true);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let bestaande: Option<Instantie> =
                    std::fs::read(&pad).ok().and_then(|b| serde_json::from_slice(&b).ok());
                if !claim_overnemen(bestaande.as_ref(), eigen, |i| proces_leeft(i.pid, i.gestart_ms)) {
                    return Ok(false);
                }
                if bestaande.as_ref().map(|b| b.id == eigen.id).unwrap_or(false) {
                    return Ok(true);
                }
                let _ = std::fs::remove_file(&pad);
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(false)
}

// ─── Commando's ────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HerstelInfo {
    pub map: String,
    pub crashlog_map: String,
    pub instantie: Instantie,
    pub versie: String,
    pub headless: bool,
    /// Automatisch herladen na een renderer-crash (crashlog.rs).
    pub webview: crashlog::HerlaadStatus,
}

/// Wordt aangeroepen bij elke start van de frontend, ook na een herlaadbeurt:
/// de WebView draait dan weer, een nette afsluiting mag de markering opruimen.
#[tauri::command]
pub fn herstel_info() -> Result<HerstelInfo, String> {
    WEBVIEW_UITGEVALLEN.store(false, Ordering::SeqCst);
    Ok(HerstelInfo {
        webview: crashlog::herlaad_status(),
        map: map()?.to_string_lossy().to_string(),
        crashlog_map: crashlog::crashlogmap().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        instantie: instantie().clone(),
        versie: env!("CARGO_PKG_VERSION").to_string(),
        headless: crate::headless::actief(),
    })
}

/// Schrijf een bestand in de herstelmap, atomisch. Pad in de kop
/// `x-opds-pad` (URL-gecodeerd), bytes als ruwe body.
#[tauri::command]
pub async fn herstel_schrijf(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let kop = request.headers().get("x-opds-pad")
        .ok_or("Missing recovery path")?.to_str().map_err(|e| e.to_string())?;
    let rel = urlencoding::decode(kop).map_err(|e| e.to_string())?.into_owned();
    let pad = binnen(&rel)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        tauri::ipc::InvokeBody::Json(value) => {
            serde_json::from_value::<Vec<u8>>(value.get("data").cloned().ok_or("Missing file data")?)
                .map_err(|e| e.to_string())?
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(ouder) = pad.parent() {
            std::fs::create_dir_all(ouder).map_err(|e| e.to_string())?;
        }
        crate::atomic_file::write(&pad, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn herstel_lees(rel: String) -> Result<Response, String> {
    let pad = binnen(&rel)?;
    tauri::async_runtime::spawn_blocking(move || std::fs::read(&pad).map(Response::new).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn herstel_lees_tekst(rel: String) -> Result<Option<String>, String> {
    let pad = binnen(&rel)?;
    match std::fs::read_to_string(&pad) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub naam: String,
    pub map: bool,
    pub grootte: u64,
    pub gewijzigd_ms: u64,
}

/// Inhoud van een map in de herstelmap (`""` = de herstelmap zelf). Een
/// ontbrekende map geeft een lege lijst.
#[tauri::command]
pub fn herstel_lijst(rel: Option<String>) -> Result<Vec<Item>, String> {
    let doel = match rel.as_deref().filter(|r| !r.is_empty()) {
        Some(r) => binnen(r)?,
        None => map()?,
    };
    let lijst = match std::fs::read_dir(&doel) {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    Ok(lijst
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let gewijzigd_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(Item {
                naam: e.file_name().to_string_lossy().to_string(),
                map: meta.is_dir(),
                grootte: meta.len(),
                gewijzigd_ms,
            })
        })
        .collect())
}

/// Verwijder een bestand of map (met inhoud) in de herstelmap. `false` als
/// het er niet (meer) was.
#[tauri::command]
pub async fn herstel_verwijder(rel: String) -> Result<bool, String> {
    let pad = binnen(&rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let uitkomst = if pad.is_dir() { std::fs::remove_dir_all(&pad) } else { std::fs::remove_file(&pad) };
        match uitkomst {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hernoem een map binnen de herstelmap (overnemen van een hersteld document).
#[tauri::command]
pub fn herstel_hernoem(van: String, naar: String) -> Result<(), String> {
    let (van, naar) = (binnen(&van)?, binnen(&naar)?);
    if naar.exists() {
        return Err("recovery target already exists".to_string());
    }
    std::fs::rename(van, naar).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcesVraag {
    pub pid: u32,
    #[serde(default)]
    pub gestart_ms: u64,
}

/// Leven deze instanties nog?
#[tauri::command]
pub fn herstel_processen(lijst: Vec<ProcesVraag>) -> Vec<bool> {
    lijst.iter().map(|v| proces_leeft(v.pid, v.gestart_ms)).collect()
}

#[tauri::command]
pub fn herstel_claim(rel: String) -> Result<bool, String> {
    claim_in(&binnen(&rel)?, instantie())
}

/// Kopieer een momentopname naar een nieuw tijdelijk werkbestand
/// (`opds-edit-<ms>-herstel.pdf`, dat de app zelf weer opruimt) en geef de
/// app toegang. Het document opent daaruit; opslaan gaat naar het origineel.
#[tauri::command]
pub async fn herstel_werkkopie(app: tauri::AppHandle, rel: String) -> Result<String, String> {
    let bron = binnen(&rel)?;
    let doel = std::env::temp_dir().join(format!("opds-edit-{}-herstel.pdf", crashlog::nu_ms()));
    let doel_kopie = doel.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::copy(&bron, &doel_kopie).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())??;
    let _ = app.fs_scope().allow_file(&doel);
    Ok(doel.to_string_lossy().to_string())
}

/// Schrijf een momentopname naar een door de gebruiker gekozen pad (Opslaan
/// als…), atomisch.
#[tauri::command]
pub async fn herstel_kopieer(rel: String, doel: String) -> Result<(), String> {
    let bron = binnen(&rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&bron).map_err(|e| e.to_string())?;
        crate::atomic_file::write(Path::new(&doel), &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BronInfo {
    pub grootte: u64,
    pub gewijzigd_ms: u64,
}

/// Grootte en wijzigingstijd van het origineel (voor het manifest).
#[tauri::command]
pub fn herstel_bron_info(pad: String) -> Option<BronInfo> {
    let meta = std::fs::metadata(&pad).ok()?;
    if !meta.is_file() {
        return None;
    }
    let gewijzigd_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(BronInfo { grootte: meta.len(), gewijzigd_ms })
}

/// Een regel in het crashlog vanuit de frontend.
#[tauri::command]
pub fn herstel_crashlog(soort: String, bericht: String) {
    crashlog::schrijf(&soort, &bericht);
}

/// Een regel in het gewone logboek (en stderr) vanuit de herstelcode, bv. het
/// herstelaanbod van een headless instantie.
#[tauri::command]
pub fn herstel_log(bericht: String) {
    let bericht = crashlog::kort(&bericht, 4000);
    eprintln!("[herstel] {bericht}");
    log::warn!("[herstel] {bericht}");
}

/// De frontend sluit netjes af: de markering mag bij het afsluiten weg.
#[tauri::command]
pub fn herstel_schoon_afsluiten() {
    SCHOON.store(true, Ordering::SeqCst);
}

/// De frontend heeft de noodmomentopname gemaakt (of had niets te bewaren).
#[tauri::command]
pub fn herstel_nood_klaar() {
    crashlog::nood_klaar();
}

/// Pure regel: is het testcommando vrijgegeven?
pub fn test_toegestaan(waarde: Option<&str>) -> bool {
    waarde == Some("1")
}

/// Alleen voor tests: laat het proces in paniek raken. Werkt uitsluitend met
/// `OPDS_CRASH_TEST=1` in de omgeving (ook in een release-bouw is het zonder
/// die variabele onbereikbaar).
///
/// * `draad`: paniek in een nieuwe draad; het proces blijft draaien en de
///   paniekhaak vraagt een noodmomentopname.
/// * `hoofd`: paniek op de hoofddraad (event-loop); het proces stopt.
#[tauri::command]
pub fn herstel_test_paniek(app: tauri::AppHandle, soort: String) -> Result<(), String> {
    if !test_toegestaan(std::env::var(TEST_VAR).ok().as_deref()) {
        return Err(format!("not available without {TEST_VAR}=1"));
    }
    match soort.as_str() {
        "draad" => {
            std::thread::Builder::new()
                .name("opds-crash-test".to_string())
                .spawn(|| panic!("test panic requested via herstel_test_paniek (thread)"))
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        "hoofd" => app
            .run_on_main_thread(|| panic!("test panic requested via herstel_test_paniek (main thread)"))
            .map_err(|e| e.to_string()),
        _ => Err("unknown kind (draad|hoofd)".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestMap(PathBuf);
    impl TestMap {
        fn nieuw(naam: &str) -> Self {
            let p = std::env::temp_dir().join(format!("opds-herstel-test-{naam}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for TestMap {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn alleen_veilige_relatieve_paden() {
        assert_eq!(veilig_relatief("a_1/manifest.json").unwrap(), PathBuf::from("a_1").join("manifest.json"));
        assert_eq!(veilig_relatief("a\\b.pdf").unwrap(), PathBuf::from("a").join("b.pdf"));
        for slecht in ["", "..", "../x", "a/../b", "/abs", "C:/x", "a//b", ".verborgen", "a/.opds-save-1.tmp", "a b", "a/ü"] {
            assert!(veilig_relatief(slecht).is_err(), "{slecht:?} zou geweigerd moeten worden");
        }
    }

    #[test]
    fn eigen_proces_leeft_en_een_verzonnen_niet() {
        let i = instantie();
        assert!(proces_leeft(i.pid, i.gestart_ms));
        assert!(!proces_leeft(i.pid, i.gestart_ms + 10_000), "andere starttijd = ander proces");
        assert!(!proces_leeft(0, 0));
        // Een pid dat (vrijwel) zeker niet bestaat.
        assert!(!proces_leeft(4_000_000_000, 1));
    }

    #[test]
    fn starttijd_vergelijking() {
        assert!(!starttijd_past(None, 5));
        assert!(starttijd_past(Some(0), 5));
        assert!(starttijd_past(Some(10_000), 10_500));
        assert!(!starttijd_past(Some(10_000), 12_000));
        assert!(starttijd_past(Some(10_000), 0));
    }

    #[test]
    fn marker_alleen_weg_na_schoon_afsluiten() {
        assert!(marker_weg_bij_afsluiten(true, false));
        assert!(!marker_weg_bij_afsluiten(false, false));
        assert!(!marker_weg_bij_afsluiten(true, true));
    }

    #[test]
    fn marker_schrijven_is_atomisch_en_leesbaar() {
        let map = TestMap::nieuw("marker");
        let m = Marker { id: "12-34".into(), pid: 12, gestart_ms: 34, versie: "x".into(), tweede: false, headless: true };
        let pad = schrijf_marker_in(&map.0, &m).unwrap();
        let terug: Marker = serde_json::from_slice(&std::fs::read(&pad).unwrap()).unwrap();
        assert_eq!(terug.id, "12-34");
        let namen: Vec<_> = std::fs::read_dir(map.0.join(MARKERMAP)).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(namen.len(), 1, "geen tijdelijke bestanden achtergebleven");
    }

    #[test]
    fn claim_tussen_instanties() {
        let map = TestMap::nieuw("claim");
        let ik = instantie().clone();
        assert!(claim_in(&map.0, &ik).unwrap());
        assert!(claim_in(&map.0, &ik).unwrap(), "eigen claim blijft geldig");
        // Een claim van een dood proces wordt overgenomen.
        let dood = Instantie { id: "4000000000-1".into(), pid: 4_000_000_000, gestart_ms: 1 };
        std::fs::write(map.0.join("claim"), serde_json::to_vec(&dood).unwrap()).unwrap();
        assert!(claim_in(&map.0, &ik).unwrap());
        // Een claim van een levende andere instantie niet.
        let levend = Instantie { id: "x".into(), pid: 1, gestart_ms: 0 };
        assert!(!claim_overnemen(Some(&levend), &ik, |_| true));
        assert!(claim_overnemen(Some(&levend), &ik, |_| false));
        assert!(claim_overnemen(None, &ik, |_| true));
    }

    #[test]
    fn testcommando_alleen_met_variabele() {
        assert!(test_toegestaan(Some("1")));
        assert!(!test_toegestaan(None));
        assert!(!test_toegestaan(Some("0")));
        assert!(!test_toegestaan(Some("true")));
    }
}
