//! Lagenstand van de weergave (#684).
//!
//! PDFium tekent optionele inhoud volgens de standaardconfiguratie van het
//! document zelf; een andere stand kent het niet. Schakelt de gebruiker een
//! laag, dan maakt de webview een weergavekopie (het bestand met één
//! incrementele update die /OCProperties /D vervangt, zie js/pdf/laagstand.js)
//! en meldt die hier aan. Vanaf dan tekenen de render-opdrachten voor dat pad
//! uit de kopie; het pad zelf, opslaan en de andere opdrachten blijven bij het
//! origineel. Caches die op pad sleutelen, sleutelen zo vanzelf op de kopie.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn kaart() -> &'static Mutex<HashMap<String, String>> {
    static KAART: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    KAART.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Het pad waaruit de pagina's van `pad` getekend worden: de weergavekopie als
/// er lagen geschakeld zijn, anders `pad` zelf.
pub fn tekenpad(pad: &str) -> String {
    kaart()
        .lock()
        .ok()
        .and_then(|k| k.get(pad).cloned())
        .unwrap_or_else(|| pad.to_string())
}

/// Meldt de weergavekopie van `pad` aan (`Some`) of af (`None`). Geeft de
/// vorige kopie terug; die mag de webview na het vrijgeven van zijn caches
/// verwijderen.
pub fn zet(pad: &str, kopie: Option<String>) -> Option<String> {
    let mut k = match kaart().lock() {
        Ok(k) => k,
        Err(e) => e.into_inner(),
    };
    match kopie {
        Some(kopie) if kopie != pad => k.insert(pad.to_string(), kopie),
        _ => k.remove(pad),
    }
}

/// Het document is dicht: geen kopie meer voor dit pad.
pub fn vergeet(pad: &str) {
    zet(pad, None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zonder_kopie_tekent_het_origineel() {
        assert_eq!(tekenpad("C:/t/zonder.pdf"), "C:/t/zonder.pdf");
    }

    #[test]
    fn aanmelden_omleiden_en_afmelden() {
        let pad = "C:/t/tekening.pdf";
        assert_eq!(zet(pad, Some("C:/tmp/opds-lagen-1.pdf".into())), None);
        assert_eq!(tekenpad(pad), "C:/tmp/opds-lagen-1.pdf");
        assert_eq!(zet(pad, Some("C:/tmp/opds-lagen-2.pdf".into())).as_deref(), Some("C:/tmp/opds-lagen-1.pdf"));
        assert_eq!(tekenpad(pad), "C:/tmp/opds-lagen-2.pdf");
        assert_eq!(zet(pad, None).as_deref(), Some("C:/tmp/opds-lagen-2.pdf"));
        assert_eq!(tekenpad(pad), pad);
    }

    #[test]
    fn vergeten_bij_sluiten() {
        let pad = "C:/t/dicht.pdf";
        zet(pad, Some("C:/tmp/opds-lagen-3.pdf".into()));
        vergeet(pad);
        assert_eq!(tekenpad(pad), pad);
    }
}
