//! Pure regels van de headless modus, zonder Tauri of andere crates.
//!
//! Dit bestand hangt alleen van `std` af, zodat de tests ook los te draaien
//! zijn (de testbinary van de app-crate start op sommige machines niet):
//!
//! ```text
//! rustc --edition 2021 --test src/headless/regels.rs -o regels-test.exe && regels-test.exe
//! ```

/// Standaard-binnenmaat (logische pixels) van een headless venster: gelijk
/// aan de gewone startmaat uit tauri.conf.json, zodat schermafdrukken van een
/// headless instantie hetzelfde beeld geven als van een zichtbare.
pub const STANDAARD_BREEDTE: u32 = 1200;
pub const STANDAARD_HOOGTE: u32 = 800;

/// Grenzen voor `OPDS_HEADLESS_SIZE`. Buiten deze grenzen geldt de standaard.
const MIN_BREEDTE: u32 = 320;
const MIN_HOOGTE: u32 = 240;
const MAX_BREEDTE: u32 = 7680;
const MAX_HOOGTE: u32 = 4320;

/// Wat wry standaard uitschakelt als er geen eigen browserargumenten zijn
/// (minimenu, PDF-weergave van de browser, SmartScreen). Een headless
/// instantie geeft wél eigen argumenten mee en neemt deze daarom zelf over.
pub const WRY_UITGESCHAKELD: [&str; 3] = ["msWebOOUI", "msPdfOOUI", "msSmartScreenProtection"];

/// Chromium-functie die een venster buiten beeld als "bedekt" aanmerkt en het
/// renderen dan stillegt.
pub const HEADLESS_UITGESCHAKELD: &str = "CalculateNativeWinOcclusion";

/// Vlaggen die voorkomen dat Chromium een niet-zichtbaar venster afknijpt
/// (renderer op lage prioriteit, timers vertraagd).
pub const HEADLESS_VLAGGEN: [&str; 3] = [
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
];

const DISABLE_FEATURES: &str = "--disable-features=";

/// Afstand (fysieke pixels) tussen het geparkeerde venster en de rand van het
/// totale bureaublad.
pub const PARKEERMARGE: i32 = 2000;

/// Telt een waarde als "aan"? `1`, `true`, `yes` en `on`, ongeacht hoofdletters.
pub fn is_aan(waarde: Option<&str>) -> bool {
    matches!(
        waarde.map(|w| w.trim().to_ascii_lowercase()).as_deref(),
        Some("1") | Some("true") | Some("yes") | Some("on")
    )
}

/// Headless geldt alleen voor een testinstantie: `OPDS_HEADLESS` aan EN de
/// instantie draait met `--mcp-server` of met `OPDS_DETACHED=1` (dezelfde
/// toets als de single-instance-overslag in instantie.rs). Een gewone start
/// negeert de variabele dus, ook als die per ongeluk in de omgeving staat.
pub fn is_actief(opds_headless: Option<&str>, opds_detached: Option<&str>, mcp_server: bool) -> bool {
    is_aan(opds_headless) && (mcp_server || opds_detached == Some("1"))
}

/// Binnenmaat uit `OPDS_HEADLESS_SIZE` (`BxH`, bv. `1600x900`). Ontbreekt de
/// waarde of klopt ze niet, dan de standaardmaat.
pub fn venstergrootte(waarde: Option<&str>) -> (u32, u32) {
    let standaard = (STANDAARD_BREEDTE, STANDAARD_HOOGTE);
    let Some(waarde) = waarde.map(str::trim).filter(|w| !w.is_empty()) else {
        return standaard;
    };
    let lager = waarde.to_ascii_lowercase();
    let Some((b, h)) = lager.split_once('x') else {
        return standaard;
    };
    match (b.trim().parse::<u32>(), h.trim().parse::<u32>()) {
        (Ok(b), Ok(h))
            if (MIN_BREEDTE..=MAX_BREEDTE).contains(&b) && (MIN_HOOGTE..=MAX_HOOGTE).contains(&h) =>
        {
            (b, h)
        }
        _ => standaard,
    }
}

/// Browserargumenten voor WebView2 in headless modus, samengevoegd met wat er
/// al stond (bv. `--remote-debugging-port=9357` uit
/// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`).
///
/// - Alle overige argumenten blijven in hun volgorde staan.
/// - Alle `--disable-features=`-lijsten worden één lijst: Chromium leest maar
///   één zo'n schakelaar, een tweede zou de eerste overschrijven. Eerst wat
///   wry standaard uitschakelt, dan de bestaande, dan
///   `CalculateNativeWinOcclusion`; zonder dubbele namen.
/// - Daarna de vlaggen tegen afknijpen, elk één keer.
///
/// Idempotent: het resultaat nogmaals invoeren geeft hetzelfde resultaat. Dat
/// is nodig omdat een losgemaakt tabblad (tweede instantie) de omgeving erft
/// en op dezelfde WebView2-datamap exact dezelfde opties moet hebben.
pub fn browser_args(bestaand: Option<&str>) -> String {
    let mut overige: Vec<&str> = Vec::new();
    let mut functies: Vec<String> = WRY_UITGESCHAKELD.iter().map(|f| f.to_string()).collect();

    for deel in bestaand.unwrap_or("").split_whitespace() {
        if let Some(lijst) = deel.strip_prefix(DISABLE_FEATURES) {
            for functie in lijst.split(',').map(str::trim).filter(|f| !f.is_empty()) {
                if !functies.iter().any(|f| f == functie) {
                    functies.push(functie.to_string());
                }
            }
        } else if !HEADLESS_VLAGGEN.contains(&deel) {
            overige.push(deel);
        }
    }
    if !functies.iter().any(|f| f == HEADLESS_UITGESCHAKELD) {
        functies.push(HEADLESS_UITGESCHAKELD.to_string());
    }

    let mut delen: Vec<String> = overige.into_iter().map(str::to_string).collect();
    delen.push(format!("{DISABLE_FEATURES}{}", functies.join(",")));
    delen.extend(HEADLESS_VLAGGEN.iter().map(|v| v.to_string()));
    delen.join(" ")
}

/// Rechthoek in fysieke schermpixels (linkerbovenhoek + maat).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rechthoek {
    pub x: i32,
    pub y: i32,
    pub breedte: i32,
    pub hoogte: i32,
}

impl Rechthoek {
    pub fn new(x: i32, y: i32, breedte: i32, hoogte: i32) -> Self {
        Self { x, y, breedte, hoogte }
    }

    fn rechts(&self) -> i64 {
        self.x as i64 + self.breedte.max(0) as i64
    }

    fn onder(&self) -> i64 {
        self.y as i64 + self.hoogte.max(0) as i64
    }

    /// Overlappen de twee rechthoeken (een gedeelde rand telt niet)?
    pub fn snijdt(&self, ander: &Rechthoek) -> bool {
        (self.x as i64) < ander.rechts()
            && (ander.x as i64) < self.rechts()
            && (self.y as i64) < ander.onder()
            && (ander.y as i64) < self.onder()
    }

    /// Kwadraat van de kortste afstand tussen de twee rechthoeken (0 bij overlap).
    fn afstand2(&self, ander: &Rechthoek) -> i64 {
        let dx = (ander.x as i64 - self.rechts()).max(self.x as i64 - ander.rechts()).max(0);
        let dy = (ander.y as i64 - self.onder()).max(self.y as i64 - ander.onder()).max(0);
        dx * dx + dy * dy
    }
}

/// Valt het venster (deels) op een van de monitoren?
pub fn snijdt_een_monitor(venster: &Rechthoek, monitoren: &[Rechthoek]) -> bool {
    monitoren.iter().any(|m| venster.snijdt(m))
}

/// Parkeerplek (linkerbovenhoek, fysieke pixels) voor een venster van
/// `breedte` x `hoogte`: buiten ELKE monitor, met de hoofdmonitor als
/// dichtstbijzijnde monitor. Dat laatste houdt de DPI van het venster gelijk
/// aan die van de hoofdmonitor (Windows kent een venster buiten beeld de DPI
/// van de dichtstbijzijnde monitor toe), zodat de schermafdrukken een vaste
/// maat hebben.
///
/// Kandidaten, in deze volgorde: boven, onder, links, rechts van het hele
/// bureaublad, steeds gecentreerd op de hoofdmonitor. De eerste waarvan de
/// hoofdmonitor het dichtst bij ligt wint; anders de eerste kandidaat.
pub fn parkeerpositie(monitoren: &[Rechthoek], hoofd: Option<usize>, breedte: i32, hoogte: i32) -> (i32, i32) {
    let breedte = breedte.max(1);
    let hoogte = hoogte.max(1);
    if monitoren.is_empty() {
        return (-(breedte + 10 * PARKEERMARGE), -(hoogte + 10 * PARKEERMARGE));
    }
    let hoofd_idx = hoofd.filter(|&i| i < monitoren.len()).unwrap_or(0);
    let p = monitoren[hoofd_idx];

    let links = monitoren.iter().map(|m| m.x as i64).min().unwrap_or(0);
    let boven = monitoren.iter().map(|m| m.y as i64).min().unwrap_or(0);
    let rechts = monitoren.iter().map(Rechthoek::rechts).max().unwrap_or(0);
    let onder = monitoren.iter().map(Rechthoek::onder).max().unwrap_or(0);
    let marge = PARKEERMARGE as i64;
    let klem = |v: i64| v.clamp(i32::MIN as i64 / 2, i32::MAX as i64 / 2) as i32;

    // Gecentreerd op de hoofdmonitor, zodat een buurmonitor die tegen de
    // hoofdmonitor aan ligt niet even dichtbij komt.
    let midden_x = klem(p.x as i64 + (p.breedte as i64 - breedte as i64) / 2);
    let midden_y = klem(p.y as i64 + (p.hoogte as i64 - hoogte as i64) / 2);

    let kandidaten = [
        (midden_x, klem(boven - hoogte as i64 - marge)),
        (midden_x, klem(onder + marge)),
        (klem(links - breedte as i64 - marge), midden_y),
        (klem(rechts + marge), midden_y),
    ];

    let hoofd_dichtst = |(x, y): (i32, i32)| {
        let r = Rechthoek::new(x, y, breedte, hoogte);
        if snijdt_een_monitor(&r, monitoren) {
            return false;
        }
        let tot_hoofd = r.afstand2(&p);
        monitoren
            .iter()
            .enumerate()
            .all(|(i, m)| i == hoofd_idx || r.afstand2(m) > tot_hoofd)
    };

    kandidaten
        .iter()
        .copied()
        .find(|&k| hoofd_dichtst(k))
        .unwrap_or(kandidaten[0])
}

/// Antwoord van een onderdrukt berichtvenster (`plugin:dialog|message`), zoals
/// een gebruiker die het venster wegklikt: bij alleen een OK-knop "Ok", bij
/// Ja/Nee "No", anders "Cancel". `knoppen` is de soort knoppen zoals de
/// dialoog-API die meestuurt: de tekst zelf (`"YesNo"`, `"OkCancel"`, …) of de
/// sleutel van het object (`"OkCustom"`, `"YesNoCancelCustom"`, …).
pub fn dialoog_antwoord(knoppen: Option<&str>) -> &'static str {
    match knoppen {
        None | Some("Ok") | Some("OkCustom") => "Ok",
        Some("YesNo") => "No",
        Some(_) => "Cancel",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aan_alleen_voor_duidelijke_waarden() {
        for w in ["1", "true", "TRUE", " yes ", "On"] {
            assert!(is_aan(Some(w)), "{w}");
        }
        for w in ["", "0", "false", "nee", "2"] {
            assert!(!is_aan(Some(w)), "{w}");
        }
        assert!(!is_aan(None));
    }

    #[test]
    fn actief_alleen_bij_testgebruik() {
        assert!(is_actief(Some("1"), Some("1"), false));
        assert!(is_actief(Some("1"), None, true));
        assert!(!is_actief(Some("1"), None, false), "gewone start negeert OPDS_HEADLESS");
        assert!(!is_actief(None, Some("1"), true));
        assert!(!is_actief(Some("0"), Some("1"), true));
    }

    #[test]
    fn venstergrootte_uit_omgeving() {
        assert_eq!(venstergrootte(None), (1200, 800));
        assert_eq!(venstergrootte(Some("")), (1200, 800));
        assert_eq!(venstergrootte(Some("1600x900")), (1600, 900));
        assert_eq!(venstergrootte(Some(" 1024 X 768 ")), (1024, 768));
        assert_eq!(venstergrootte(Some("10x10")), (1200, 800));
        assert_eq!(venstergrootte(Some("99999x800")), (1200, 800));
        assert_eq!(venstergrootte(Some("breed")), (1200, 800));
        assert_eq!(venstergrootte(Some("1600x")), (1200, 800));
    }

    #[test]
    fn browser_args_zonder_bestaande() {
        assert_eq!(
            browser_args(None),
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
             --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
             --disable-background-timer-throttling"
        );
    }

    #[test]
    fn browser_args_behoudt_debugpoort_en_voegt_features_samen() {
        let uit = browser_args(Some("--remote-debugging-port=9357 --disable-features=Foo,msPdfOOUI --lang=nl"));
        assert_eq!(
            uit,
            "--remote-debugging-port=9357 --lang=nl \
             --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,Foo,CalculateNativeWinOcclusion \
             --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
             --disable-background-timer-throttling"
        );
        assert_eq!(uit.matches("--disable-features=").count(), 1);
        assert_eq!(uit.matches("--remote-debugging-port=9357").count(), 1);
    }

    #[test]
    fn browser_args_is_idempotent() {
        for invoer in [
            None,
            Some("--remote-debugging-port=9357"),
            Some("  --disable-renderer-backgrounding --disable-features=A --disable-features=B,A  "),
        ] {
            let een = browser_args(invoer);
            assert_eq!(browser_args(Some(&een)), een, "{invoer:?}");
        }
    }

    #[test]
    fn snijden_en_rand() {
        let m = Rechthoek::new(0, 0, 1920, 1080);
        assert!(Rechthoek::new(100, 100, 10, 10).snijdt(&m));
        assert!(!Rechthoek::new(1920, 0, 10, 10).snijdt(&m), "gedeelde rand telt niet");
        assert!(!Rechthoek::new(-10, -10, 10, 10).snijdt(&m));
    }

    #[test]
    fn parkeren_bij_een_monitor() {
        let m = [Rechthoek::new(0, 0, 1920, 1080)];
        let (x, y) = parkeerpositie(&m, Some(0), 1800, 1200);
        assert_eq!((x, y), (60, -1200 - PARKEERMARGE));
        assert!(!snijdt_een_monitor(&Rechthoek::new(x, y, 1800, 1200), &m));
    }

    #[test]
    fn parkeren_met_monitor_boven_de_hoofdmonitor() {
        // Tweede monitor recht boven de hoofdmonitor: "boven" ligt dichter bij
        // die tweede monitor, dus wordt het "onder".
        let m = [Rechthoek::new(0, 0, 2560, 1440), Rechthoek::new(0, -1080, 1920, 1080)];
        let (x, y) = parkeerpositie(&m, Some(0), 1200, 800);
        assert_eq!((x, y), (680, 1440 + PARKEERMARGE));
        assert!(!snijdt_een_monitor(&Rechthoek::new(x, y, 1200, 800), &m));
    }

    #[test]
    fn parkeren_met_monitoren_naast_elkaar() {
        let m = [
            Rechthoek::new(-1920, 0, 1920, 1080),
            Rechthoek::new(0, 0, 2560, 1440),
            Rechthoek::new(2560, 200, 1920, 1080),
        ];
        let (x, y) = parkeerpositie(&m, Some(1), 1500, 1000);
        assert_eq!((x, y), (530, -1000 - PARKEERMARGE));
        assert!(!snijdt_een_monitor(&Rechthoek::new(x, y, 1500, 1000), &m));
    }

    #[test]
    fn parkeren_zonder_monitoren_of_met_onbekende_hoofdmonitor() {
        let (x, y) = parkeerpositie(&[], None, 1200, 800);
        assert!(x < -1200 && y < -800);
        let m = [Rechthoek::new(0, 0, 1920, 1080)];
        let (x, y) = parkeerpositie(&m, Some(7), 1200, 800);
        assert!(!snijdt_een_monitor(&Rechthoek::new(x, y, 1200, 800), &m));
    }

    #[test]
    fn dialoog_antwoorden() {
        assert_eq!(dialoog_antwoord(None), "Ok");
        assert_eq!(dialoog_antwoord(Some("Ok")), "Ok");
        assert_eq!(dialoog_antwoord(Some("OkCustom")), "Ok");
        assert_eq!(dialoog_antwoord(Some("YesNo")), "No");
        assert_eq!(dialoog_antwoord(Some("OkCancel")), "Cancel");
        assert_eq!(dialoog_antwoord(Some("YesNoCancel")), "Cancel");
        assert_eq!(dialoog_antwoord(Some("OkCancelCustom")), "Cancel");
        assert_eq!(dialoog_antwoord(Some("YesNoCancelCustom")), "Cancel");
    }
}
