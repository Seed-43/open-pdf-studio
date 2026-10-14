//! Opname van wat de WebView werkelijk toont, als PNG (#583).
//!
//! `app_screenshot_view` met `scope: "window"` of `"element"` legt het hele
//! venster vast: lint (ook de tabbladen van extensies), zijpanelen, de
//! documentweergave en de statusbalk. De canvassen in de WebView volstaan daar
//! niet voor, dus vraagt de WebView via `capture_webview_png` om een echte
//! opname. Het bijsnijden en verkleinen doet de JS-kant
//! (js/core/mcp-schermafdruk.js), zodat de rekenregels op één plek staan.
//!
//! Windows: `ICoreWebView2::CapturePreview` schrijft een PNG in een IStream, in
//! fysieke pixels. Op andere platformen is er nog geen opname; het commando
//! geeft dan een duidelijke fout in plaats van een verkeerd beeld.
//! `scope: "document"` werkt overal, want die loopt alleen via de canvassen.

use tauri::ipc::Response;

/// De foutmelding buiten Windows; de JS-kant geeft hem ongewijzigd door.
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub const NIET_ONDERSTEUND: &str =
    "scope \"window\" and \"element\" are not supported on this platform yet; use scope \"document\"";

/// Neem de WebView op die dit commando aanroept. Geeft de PNG als ruwe bytes
/// (in JS een ArrayBuffer), zonder base64-omweg.
#[tauri::command]
pub async fn capture_webview_png(webview: tauri::Webview) -> Result<Response, String> {
    let png = neem_op(&webview).await?;
    Ok(Response::new(png))
}

#[cfg(not(target_os = "windows"))]
async fn neem_op(_webview: &tauri::Webview) -> Result<Vec<u8>, String> {
    Err(NIET_ONDERSTEUND.to_string())
}

#[cfg(target_os = "windows")]
type Afzender = std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>>>>;

#[cfg(target_os = "windows")]
fn verstuur(afzender: &Afzender, uitkomst: Result<Vec<u8>, String>) {
    if let Some(tx) = afzender.lock().ok().and_then(|mut slot| slot.take()) {
        let _ = tx.send(uitkomst);
    }
}

#[cfg(target_os = "windows")]
async fn neem_op(webview: &tauri::Webview) -> Result<Vec<u8>, String> {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let afzender: Afzender = Arc::new(Mutex::new(Some(tx)));
    let voor_ui = afzender.clone();
    // De WebView2-aanroepen moeten op de UI-thread; het resultaat komt later
    // via de voltooiingshandler, ook op de UI-thread. Hier wachten we alleen.
    webview
        .with_webview(move |platform| {
            // SAFETY: we zitten op de UI-thread van deze WebView (with_webview).
            if let Err(fout) = unsafe { start_opname(platform.controller(), voor_ui.clone()) } {
                verstuur(&voor_ui, Err(fout));
            }
        })
        .map_err(|e| format!("with_webview: {e}"))?;
    match tokio::time::timeout(Duration::from_secs(15), rx).await {
        Ok(Ok(uitkomst)) => uitkomst,
        Ok(Err(_)) => Err("the window capture was cancelled".to_string()),
        Err(_) => Err("the window capture did not finish within 15 s".to_string()),
    }
}

#[cfg(target_os = "windows")]
unsafe fn start_opname(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    afzender: Afzender,
) -> Result<(), String> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

    let kern = controller.CoreWebView2().map_err(|e| format!("CoreWebView2: {e}"))?;
    // Een geheugenstroom die zichzelf opruimt zodra de laatste verwijzing weg is.
    let stroom = CreateStreamOnHGlobal(HGLOBAL::default(), true)
        .map_err(|e| format!("CreateStreamOnHGlobal: {e}"))?;
    let voor_handler = stroom.clone();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |resultaat| {
        let uitkomst = match resultaat {
            // SAFETY: de stroom leeft via `voor_handler` tot hier.
            Ok(()) => unsafe { lees_stroom(&voor_handler) },
            Err(e) => Err(format!("CapturePreview: {e}")),
        };
        verstuur(&afzender, uitkomst);
        Ok(())
    }));
    kern.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stroom, &handler)
        .map_err(|e| format!("CapturePreview: {e}"))
}

#[cfg(target_os = "windows")]
unsafe fn lees_stroom(stroom: &windows::Win32::System::Com::IStream) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    let mut stat = STATSTG::default();
    stroom.Stat(&mut stat, STATFLAG_NONAME).map_err(|e| format!("IStream::Stat: {e}"))?;
    let grootte = usize::try_from(stat.cbSize).map_err(|_| "capture is too large".to_string())?;
    if grootte == 0 {
        return Err("the window capture is empty".to_string());
    }
    stroom.Seek(0, STREAM_SEEK_SET, None).map_err(|e| format!("IStream::Seek: {e}"))?;
    let mut buffer = vec![0u8; grootte];
    let mut totaal = 0usize;
    while totaal < grootte {
        let mut gelezen = 0u32;
        let rest = u32::try_from(grootte - totaal).unwrap_or(u32::MAX);
        stroom
            .Read(buffer.as_mut_ptr().add(totaal).cast(), rest, Some(&mut gelezen))
            .ok()
            .map_err(|e| format!("IStream::Read: {e}"))?;
        if gelezen == 0 {
            break;
        }
        totaal += gelezen as usize;
    }
    buffer.truncate(totaal);
    if buffer.is_empty() {
        return Err("the window capture is empty".to_string());
    }
    Ok(buffer)
}
