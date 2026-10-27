//! Thin Lines view mode (#595): every vector stroke of a page drawn as a
//! hairline, whatever line width the PDF asks for.
//!
//! PDFium has no render flag for this. The PDF specification (ISO 32000-1,
//! 8.4.3.2) defines line width 0 as "the thinnest line that can be rendered
//! at device resolution: 1 device pixel wide", and PDFium honours that, so
//! setting the stroke width of every path object to 0 before rendering gives
//! exactly the hairline look. The change only lives in the parsed page in
//! memory: nothing regenerates the content stream and nothing is saved.
//!
//! Shared by the pdfium-worker sidecar and the in-process renderer of the app
//! (`open-pdf-studio/src-tauri/src/pdfium_renderer.rs` includes this file), so
//! both render paths thin exactly the same objects.

use pdfium_render::prelude::*;

/// What a cached page handle needs before it is rendered in the wanted mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrokeModeChange {
    /// The page is already in the wanted mode.
    None,
    /// Store the widths, then set every stroke to a hairline.
    Thin,
    /// Put the stored widths back.
    Restore,
}

/// Decides how a page whose strokes are (or are not) thinned reaches the
/// wanted mode.
pub fn stroke_mode_change(thinned: bool, want_thin: bool) -> StrokeModeChange {
    match (thinned, want_thin) {
        (false, true) => StrokeModeChange::Thin,
        (true, false) => StrokeModeChange::Restore,
        _ => StrokeModeChange::None,
    }
}

fn visit_paths(object: &mut PdfPageObject<'_>, f: &mut dyn FnMut(&mut PdfPageObject<'_>)) {
    match object.object_type() {
        PdfPageObjectType::Path => f(object),
        // Lines inside form XObjects (blocks, title blocks, symbols in CAD
        // exports) are drawn through the form: walk into it.
        PdfPageObjectType::XObjectForm => {
            if let Some(form) = object.as_x_object_form_object() {
                for i in 0..form.len() {
                    if let Ok(mut child) = form.get(i) {
                        visit_paths(&mut child, f);
                    }
                }
            }
        }
        _ => {}
    }
}

/// Calls `f` for every path object of the page, form XObjects included, in a
/// fixed order (the order of the content stream).
fn for_each_path(page: &PdfPage<'_>, f: &mut dyn FnMut(&mut PdfPageObject<'_>)) {
    let objects = page.objects();
    for i in 0..objects.len() {
        if let Ok(mut object) = objects.get(i) {
            visit_paths(&mut object, f);
        }
    }
}

/// Sets every stroke of the page to a hairline. Returns the original widths in
/// visiting order, for `restore_strokes`.
pub fn thin_strokes(page: &PdfPage<'_>) -> Vec<f32> {
    let mut originals = Vec::new();
    for_each_path(page, &mut |object| {
        originals.push(object.stroke_width().map(|w| w.value).unwrap_or(0.0));
        let _ = object.set_stroke_width(PdfPoints::ZERO);
    });
    originals
}

/// Puts the widths `thin_strokes` returned back on the same page handle.
pub fn restore_strokes(page: &PdfPage<'_>, originals: &[f32]) {
    let mut i = 0usize;
    for_each_path(page, &mut |object| {
        if let Some(width) = originals.get(i) {
            let _ = object.set_stroke_width(PdfPoints::new(*width));
        }
        i += 1;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_in_the_wanted_mode_is_left_alone() {
        assert_eq!(stroke_mode_change(false, false), StrokeModeChange::None);
        assert_eq!(stroke_mode_change(true, true), StrokeModeChange::None);
    }

    #[test]
    fn switching_on_thins_and_switching_off_restores() {
        assert_eq!(stroke_mode_change(false, true), StrokeModeChange::Thin);
        assert_eq!(stroke_mode_change(true, false), StrokeModeChange::Restore);
    }
}
