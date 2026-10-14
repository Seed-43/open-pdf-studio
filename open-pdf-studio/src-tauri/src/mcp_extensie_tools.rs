//! Gestructureerde opdrachten van extensies in `tools/list` (#575).
//!
//! De WebView houdt het register bij (js/plugins/structured-commands.js) en
//! stuurt na elke wijziging de hele lijst met `mcp_set_extension_tools`. Deze
//! module bewaart die lijst, controleert hem en levert hem aan de MCP-server:
//! `tools/list` hangt hem achter de vaste gereedschappen, en een `tools/call`
//! met een `ext_`-naam gaat via `mcp:call-extension-command` naar de WebView.
//!
//! De echte controle van argumenten en resultaten gebeurt in de WebView; hier
//! alleen de vorm van de lijst, zodat een kapotte lijst nooit de vaste
//! gereedschappen verdringt of een naam van de app overschrijft.

use std::sync::Mutex;

use serde_json::{json, Value};

/// Elke extensietool begint hiermee; geen vaste tool doet dat.
pub const VOORVOEGSEL: &str = "ext_";
const MAX_TOOLS: usize = 256;
const MAX_LIJST_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct ExtensieTools {
    staat: Mutex<(u64, Vec<Value>)>,
}

/// `ext_` gevolgd door 1-60 tekens uit a-z, 0-9, `_` en `-`, met een `__`
/// tussen extensie en opdracht (zie toolNaam in structured-commands.js).
pub fn geldige_naam(naam: &str) -> bool {
    let Some(rest) = naam.strip_prefix(VOORVOEGSEL) else { return false };
    !rest.is_empty()
        && naam.len() <= 64
        && rest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
        && rest.find("__").map_or(false, |i| i > 0 && i + 2 < rest.len())
}

/// Controleer de lijst uit de WebView en bouw schone definities. Een fout
/// weigert de hele lijst; de vorige blijft dan staan.
pub fn normaliseer(tools: &[Value]) -> Result<Vec<Value>, String> {
    if tools.len() > MAX_TOOLS {
        return Err(format!("at most {MAX_TOOLS} extension tools"));
    }
    let grootte = serde_json::to_string(tools).map(|s| s.len()).unwrap_or(usize::MAX);
    if grootte > MAX_LIJST_BYTES {
        return Err("the extension tool list is larger than 2 MB".into());
    }
    let mut uit = Vec::with_capacity(tools.len());
    let mut namen = std::collections::HashSet::new();
    for t in tools {
        let naam = t["name"].as_str().unwrap_or("");
        if !geldige_naam(naam) {
            return Err(format!("invalid extension tool name: {naam:?}"));
        }
        if !namen.insert(naam.to_string()) {
            return Err(format!("duplicate extension tool name: {naam}"));
        }
        let beschrijving = t["description"].as_str().filter(|d| !d.trim().is_empty() && d.len() <= 2048)
            .ok_or_else(|| format!("{naam}: description must be text of 1-2048 bytes"))?;
        let schema = &t["inputSchema"];
        if !schema.is_object() || schema["type"] != json!("object") {
            return Err(format!("{naam}: inputSchema must be an object schema"));
        }
        let a = &t["annotations"];
        let titel = a["title"].as_str().filter(|s| !s.trim().is_empty() && s.len() <= 200)
            .ok_or_else(|| format!("{naam}: annotations.title is required"))?;
        let alleen_lezen = a["readOnlyHint"].as_bool().ok_or_else(|| format!("{naam}: annotations.readOnlyHint is required"))?;
        let wijzigt = a["destructiveHint"].as_bool().ok_or_else(|| format!("{naam}: annotations.destructiveHint is required"))?;
        uit.push(json!({
            "name": naam,
            "description": beschrijving,
            "inputSchema": schema,
            "annotations": {
                "title": titel,
                "readOnlyHint": alleen_lezen,
                "destructiveHint": wijzigt,
                "openWorldHint": false,
            },
        }));
    }
    Ok(uit)
}

impl ExtensieTools {
    /// Vervang de lijst, tenzij `seq` ouder is dan de bewaarde (een trage
    /// aanroep van vóór een nieuwere). Geeft het aantal tools.
    pub fn zet(&self, seq: u64, tools: &[Value]) -> Result<usize, String> {
        let schoon = normaliseer(tools)?;
        let mut staat = self.staat.lock().map_err(|e| format!("extension tools lock poisoned: {e}"))?;
        if seq < staat.0 {
            return Ok(staat.1.len());
        }
        let n = schoon.len();
        *staat = (seq, schoon);
        Ok(n)
    }

    pub fn lijst(&self) -> Vec<Value> {
        self.staat.lock().map(|s| s.1.clone()).unwrap_or_default()
    }

    pub fn bevat(&self, naam: &str) -> bool {
        self.staat.lock().map(|s| s.1.iter().any(|t| t["name"] == json!(naam))).unwrap_or(false)
    }
}

/// Door de WebView aangeroepen na elke wijziging van het register.
#[tauri::command]
pub fn mcp_set_extension_tools(
    tools: Vec<Value>,
    seq: u64,
    staat: tauri::State<ExtensieTools>,
) -> Result<usize, String> {
    staat.zet(seq, &tools)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(naam: &str) -> Value {
        json!({
            "name": naam, "description": "Assign a system.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "title": "Assign", "readOnlyHint": false, "destructiveHint": true, "openWorldHint": false }
        })
    }

    #[test]
    fn namen_volgen_het_patroon_van_de_webview() {
        assert!(geldige_naam("ext_nl_voorbeeld_plafond__assign_system"));
        assert!(geldige_naam("ext_nl_my-ext__x"));
        assert!(!geldige_naam("app_open_pdf"));
        assert!(!geldige_naam("ext___x"));
        assert!(!geldige_naam("ext_nl_voorbeeld__"));
        assert!(!geldige_naam("ext_nl_voorbeeld_x"), "zonder scheiding");
        assert!(!geldige_naam("ext_NL__x"));
        assert!(!geldige_naam(&format!("ext_{}__x", "a".repeat(60))));
    }

    #[test]
    fn de_lijst_wordt_gecontroleerd_en_een_oudere_lijst_genegeerd() {
        let staat = ExtensieTools::default();
        assert_eq!(staat.zet(10, &[tool("ext_a__x")]).unwrap(), 1);
        assert!(staat.bevat("ext_a__x"));
        assert_eq!(staat.zet(5, &[]).unwrap(), 1, "een oudere lijst verandert niets");
        assert!(staat.zet(11, &[tool("ext_a__x"), tool("ext_a__x")]).is_err(), "dubbele naam");
        assert!(staat.zet(11, &[tool("app_open_pdf")]).is_err(), "geen naam van de app");
        assert!(staat.bevat("ext_a__x"), "na een fout blijft de vorige lijst");
        assert_eq!(staat.zet(12, &[]).unwrap(), 0);
        assert!(!staat.bevat("ext_a__x"));
    }
}
