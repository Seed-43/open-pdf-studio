//! Shared pre-allocation policy for interactive PDFium bitmaps.
//! This bounds output buffers, not decoder allocations or total process memory.
use std::fmt;

pub const SCREEN_RGBA_BYTES: u64 = 64 * 1024 * 1024 - 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetError { InvalidGeometry, OutputLimit }
impl fmt::Display for BudgetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidGeometry => "PDF_INVALID_GEOMETRY: dimensions and scale must be finite and positive",
            Self::OutputLimit => "PDF_OUTPUT_LIMIT: bitmap exceeds the caller's RGBA budget",
        })
    }
}
impl std::error::Error for BudgetError {}

/// Validate before float-to-integer casts and before allocating a bitmap.
/// The caller owns the limit; no input-file size limit is implied.
pub fn dimensions(width: f32, height: f32, scale: f32, max_bytes: u64) -> Result<(i32, i32), BudgetError> {
    if [width, height, scale].iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return Err(BudgetError::InvalidGeometry);
    }
    // Match the backend's f32 multiplication, then check before saturating casts.
    let w = (width * scale).ceil();
    let h = (height * scale).ceil();
    if !w.is_finite() || !h.is_finite() || w as f64 > i32::MAX as f64 || h as f64 > i32::MAX as f64 {
        return Err(BudgetError::OutputLimit);
    }
    if w < 1.0 || h < 1.0 { return Err(BudgetError::InvalidGeometry); }
    if (w as u64).checked_mul(h as u64).and_then(|n| n.checked_mul(4)).is_none_or(|n| n > max_bytes) {
        return Err(BudgetError::OutputLimit);
    }
    Ok((w as i32, h as i32))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn exact_budget_and_fractional_edges() {
        assert_eq!(dimensions(10.1, 20.1, 1.0, 11*21*4), Ok((11,21)));
        assert_eq!(dimensions(10.1, 20.1, 1.0, 11*21*4-1), Err(BudgetError::OutputLimit));
    }
    #[test] fn invalid_geometry_is_not_a_zero_sized_success() {
        for n in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0.0, -1.0] {
            assert_eq!(dimensions(n, 1.0, 1.0, SCREEN_RGBA_BYTES), Err(BudgetError::InvalidGeometry));
            assert_eq!(dimensions(1.0, 1.0, n, SCREEN_RGBA_BYTES), Err(BudgetError::InvalidGeometry));
        }
    }
    #[test] fn overflow_and_large_output_fail_before_cast_or_allocation() {
        assert_eq!(dimensions(f32::MAX, 1.0, 2.0, u64::MAX), Err(BudgetError::OutputLimit));
        assert_eq!(dimensions(4096.0, 4096.0, 1.0, SCREEN_RGBA_BYTES), Err(BudgetError::OutputLimit));
        assert!(dimensions(2000.0, 2000.0, 1.0, SCREEN_RGBA_BYTES).is_ok());
    }
    #[test] fn caller_can_choose_a_smaller_budget_and_retry() {
        assert_eq!(dimensions(100.0, 100.0, 1.0, 100), Err(BudgetError::OutputLimit));
        assert_eq!(dimensions(100.0, 100.0, 0.05, 100), Ok((5,5)));
    }
}
