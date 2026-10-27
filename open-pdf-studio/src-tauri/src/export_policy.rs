//! Writing files from untrusted bytes (components of a PDF collection).
//!
//! The same rules as js/pdf/export-path-policy.js, checked again here on the
//! path as the file system resolves it: no alternate data streams, no names
//! that Windows rewrites, no network or device paths, no autostart folders
//! and, for automation clients, only document and data types. On Windows the
//! written file gets a Mark-of-the-Web (Zone.Identifier, ZoneId=3), so the
//! shell and office applications treat it as downloaded content.

use std::path::{Component, Path};

const SAFE_EXTENSIONS: &[&str] = &[
    "pdf", "fdf", "xfdf", "txt", "csv", "tsv", "json", "xml", "md", "rtf", "log",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "odg",
    "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "heic",
    "dwg", "dxf", "dwf", "ifc", "ifczip", "bcf", "bcfzip", "stp", "step", "igs", "iges", "stl", "obj", "skp", "3dm", "rvt", "nwd",
    "zip", "7z", "eml", "msg", "mp3", "wav", "mp4", "mov", "avi",
];

const AUTOSTART: &[&[&str]] = &[
    &["programs", "startup"],
    &[".config", "autostart"],
    &["etc", "xdg", "autostart"],
    &["library", "launchagents"],
    &["library", "launchdaemons"],
    &["etc", "init.d"],
    &["etc", "systemd"],
    &[".config", "systemd"],
];

fn segments(path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => { out.pop(); }
            p => out.push(p.to_lowercase()),
        }
    }
    out
}

fn in_autostart(path: &str) -> bool {
    let dirs = segments(path);
    let dirs = &dirs[..dirs.len().saturating_sub(1)];
    AUTOSTART.iter().any(|run| dirs.windows(run.len()).any(|w| w.iter().zip(run.iter()).all(|(a, b)| a == b)))
}

/// Problem code for writing `path`, or `None` when it is allowed.
/// `restrict` limits the file type to documents and data (automation clients).
pub fn problem(path: &str, restrict: bool) -> Option<&'static str> {
    if path.trim().is_empty() {
        return Some("OUTPUT_PATH_REQUIRED");
    }
    if path.chars().any(|c| c.is_control()) || path.starts_with("\\\\") || path.starts_with("//") {
        return Some("UNSAFE_PATH");
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        return Some("ABSOLUTE_PATH_REQUIRED");
    }
    // Only a drive prefix may contain a colon; anything else names a data stream.
    let rest = p.components().filter(|c| !matches!(c, Component::Prefix(_))).map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>();
    if rest.iter().any(|s| s.contains(':')) {
        return Some("UNSAFE_PATH");
    }
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if name.is_empty() || name.ends_with('.') || name.ends_with(' ') {
        return Some("UNSAFE_PATH");
    }
    // Check the folder as written and as resolved (links, short names).
    let resolved = p.parent().and_then(|d| std::fs::canonicalize(d).ok()).map(|d| d.join(&name).to_string_lossy().into_owned());
    if in_autostart(path) || resolved.as_deref().map_or(false, in_autostart) {
        return Some("AUTOSTART_LOCATION");
    }
    if restrict {
        let ext = Path::new(&name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !SAFE_EXTENSIONS.contains(&ext.as_str()) {
            return Some("BLOCKED_EXTENSION");
        }
    }
    None
}

/// Mark a file as downloaded from the internet (Windows only; elsewhere a no-op).
pub fn mark_of_the_web(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let mut stream = path.as_os_str().to_owned();
        stream.push(":Zone.Identifier");
        std::fs::write(std::path::PathBuf::from(stream), b"[ZoneTransfer]\r\nZoneId=3\r\n")?;
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_programs_streams_and_autostart() {
        #[cfg(windows)]
        {
            assert_eq!(problem("C:\\x\\a.exe", true), Some("BLOCKED_EXTENSION"));
            assert_eq!(problem("C:\\x\\a.exe.", true), Some("UNSAFE_PATH"));
            assert_eq!(problem("C:\\x\\a.pdf:b.exe", true), Some("UNSAFE_PATH"));
            assert_eq!(problem("\\\\server\\share\\a.pdf", true), Some("UNSAFE_PATH"));
            assert_eq!(problem("C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.pdf", true), Some("AUTOSTART_LOCATION"));
            assert_eq!(problem("C:\\Users\\me\\Documents\\a.pdf", true), None);
            assert_eq!(problem("C:\\Users\\me\\Documents\\a.exe", false), None);
        }
        #[cfg(not(windows))]
        {
            assert_eq!(problem("/home/me/a.sh", true), Some("BLOCKED_EXTENSION"));
            assert_eq!(problem("/home/me/.config/autostart/a.txt", true), Some("AUTOSTART_LOCATION"));
            assert_eq!(problem("/home/me/a.pdf", true), None);
        }
        assert_eq!(problem("relative.pdf", true), Some("ABSOLUTE_PATH_REQUIRED"));
    }
}
