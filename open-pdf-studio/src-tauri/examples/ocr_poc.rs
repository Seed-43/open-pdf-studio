// OCR end-to-end verification: run the REAL ocr::ocr_page_words function
// (the same code the Tauri command uses) against a real PDF and dump the
// words as JSON, so a Node script can feed them into the real JS invisible-
// text-layer writer and verify the saved PDF is actually searchable.
//
// Usage: cargo run -p open-pdf-studio --example ocr_poc -- <pdf-path> [page-index] [lang] > words.json
//
// PDFium is loaded from this platform's binaries/ directory (override with
// OPDS_PDFIUM_DIR); trained data comes from resources/tessdata, filled by
// `npm run prepare:ocr-runtime` (override with OPDS_TESSDATA_DIR).

use app_lib::{ocr, pdfium_renderer};
use std::path::{Path, PathBuf};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let pdf_path = args.get(1).expect("usage: ocr_poc <pdf-path> [page-index] [lang]");
    let page_index: u32 = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(0);
    let lang = args.get(3).cloned().unwrap_or_else(|| "chi_tra+eng".to_string());

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let platform_dir = if cfg!(target_os = "linux") {
        "binaries/linux-x64"
    } else if cfg!(target_os = "windows") {
        "binaries/win-x64"
    } else {
        "binaries/macos-universal"
    };
    let dylib_dir = std::env::var_os("OPDS_PDFIUM_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join(platform_dir));
    pdfium_renderer::init_pdfium(&dylib_dir).expect("init_pdfium failed");
    let tessdata_dir = std::env::var_os("OPDS_TESSDATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("resources").join("tessdata"));
    let tessdata = ocr::tessdata_path_for_tesseract(&tessdata_dir).expect("tessdata path");

    let bytes = std::fs::read(pdf_path).expect("read pdf");
    let cache = pdfium_renderer::PdfiumDocCache(std::sync::Mutex::new(std::collections::HashMap::new()));
    let handle = pdfium_renderer::get_or_load_pdfium_doc_with_bytes(
        pdf_path,
        std::sync::Arc::new(bytes),
        &cache,
    )
    .expect("load pdf");

    let words = ocr::ocr_page_words(handle.document(), page_index, &tessdata, &lang)
        .expect("ocr_page_words failed");

    eprintln!("Recognized {} words", words.len());
    println!("{}", serde_json::to_string(&words).unwrap());
}
