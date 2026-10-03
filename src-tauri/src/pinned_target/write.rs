//! Append-only delivery. Native handles stay on the caller's AX worker.
use super::{DeliveryState, PinFailure};

pub(super) const CHUNK_UTF16: usize = 8_000;
pub(super) const MAX_FIELD_BYTES: usize = 2_000_000;

pub(super) fn text_for_append(baseline: &str, text: &str) -> String {
    if baseline.is_empty()
        || text.is_empty()
        || baseline.ends_with(char::is_whitespace)
        || text.starts_with(char::is_whitespace)
    {
        return text.to_owned();
    }
    let separator = if text.contains('\n') { "\n" } else { " " };
    format!("{separator}{text}")
}

pub(super) trait TextField {
    fn value(&mut self) -> Result<String, PinFailure>;
    fn select_end(&mut self, utf16_offset: usize) -> Result<(), PinFailure>;
    fn selected_range(&mut self) -> Result<(usize, usize), PinFailure>;
    /// Recheck the expected value and empty end selection immediately before
    /// dispatch. An error here is conservatively treated as a possible write.
    fn insert(&mut self, text: &str, baseline: &str) -> Result<(), PinFailure>;
}

#[derive(Debug)]
pub(super) struct WriteOutcome {
    pub state: DeliveryState,
    pub reason: Option<PinFailure>,
    pub confirmed_utf16: usize,
    pub may_have_written: bool,
}

impl WriteOutcome {
    pub fn deferred(reason: PinFailure) -> Self {
        Self {
            state: if reason == PinFailure::Cancelled {
                DeliveryState::Cancelled
            } else {
                DeliveryState::Deferred
            },
            reason: Some(reason),
            confirmed_utf16: 0,
            may_have_written: false,
        }
    }
}

fn chunks(text: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let (mut start, mut units) = (0, 0);
    for (index, ch) in text.char_indices() {
        if units + ch.len_utf16() > CHUNK_UTF16 {
            result.push(&text[start..index]);
            start = index;
            units = 0;
        }
        units += ch.len_utf16();
    }
    if start < text.len() {
        result.push(&text[start..]);
    }
    result
}

/// `checkpoint` persists progress BEFORE every possible mutation, then after
/// verification. A crash or failed acknowledgement can never enable a full retry.
pub(super) fn append_verified(
    field: &mut impl TextField,
    text: &str,
    valid: impl Fn() -> bool,
    mut checkpoint: impl FnMut(usize, bool) -> Result<(), PinFailure>,
) -> WriteOutcome {
    let mut confirmed = 0;
    let mut possible = false;
    let work = (|| {
        let mut baseline = field.value()?;
        if baseline.len().saturating_add(text.len()) > MAX_FIELD_BYTES {
            return Err(PinFailure::TooLarge);
        }
        for chunk in chunks(text) {
            if !valid() {
                return Err(PinFailure::Cancelled);
            }
            let end = baseline.encode_utf16().count();
            field.select_end(end)?;
            if field.selected_range()? != (end, 0) {
                return Err(PinFailure::NotSettable);
            }
            // Never replace a selection or clobber intervening user edits.
            if field.value()? != baseline {
                return Err(PinFailure::ValueChanged);
            }
            checkpoint(confirmed, true)?;
            if !valid() {
                return Err(PinFailure::Cancelled);
            }
            // Saving the checkpoint can wait on the database. The user may
            // edit the value or selection while that happens.
            if field.value()? != baseline {
                return Err(PinFailure::ValueChanged);
            }
            if field.selected_range()? != (end, 0) {
                return Err(PinFailure::ValueChanged);
            }
            possible = true;
            field.insert(chunk, &baseline)?;
            let expected = format!("{baseline}{chunk}");
            if field.value()? != expected {
                return Err(PinFailure::VerifyFailed);
            }
            confirmed += chunk.encode_utf16().count();
            checkpoint(confirmed, true)?;
            baseline = expected;
        }
        Ok(())
    })();
    match work {
        Ok(()) => WriteOutcome {
            state: DeliveryState::Delivered,
            reason: None,
            confirmed_utf16: confirmed,
            may_have_written: possible,
        },
        Err(reason) => WriteOutcome {
            state: if confirmed > 0 {
                DeliveryState::Partial
            } else if possible {
                DeliveryState::Uncertain
            } else if reason == PinFailure::Cancelled {
                DeliveryState::Cancelled
            } else {
                DeliveryState::Deferred
            },
            reason: Some(reason),
            confirmed_utf16: confirmed,
            may_have_written: possible,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separator_preserves_word_boundaries_and_existing_whitespace() {
        assert_eq!(text_for_append("", "Hello"), "Hello");
        assert_eq!(text_for_append("Draft", "Hello"), " Hello");
        assert_eq!(text_for_append("Draft ", "Hello"), "Hello");
        assert_eq!(text_for_append("Draft", "\nHello"), "\nHello");
        assert_eq!(text_for_append("Draft", "First\nSecond"), "\nFirst\nSecond");
    }
    struct Field {
        value: String,
        range: (usize, usize),
        ignore: bool,
        edit: bool,
        inserted: usize,
        checkpoint_edit: std::rc::Rc<std::cell::Cell<u8>>,
    }
    impl TextField for Field {
        fn value(&mut self) -> Result<String, PinFailure> {
            match self.checkpoint_edit.replace(0) {
                1 => self.value.push('x'),
                2 => self.range = (0, 1),
                _ => {}
            }
            Ok(self.value.clone())
        }
        fn select_end(&mut self, offset: usize) -> Result<(), PinFailure> {
            self.range = (offset, 0);
            if self.edit {
                self.value.push('x');
            }
            Ok(())
        }
        fn selected_range(&mut self) -> Result<(usize, usize), PinFailure> {
            Ok(self.range)
        }
        fn insert(&mut self, text: &str, _baseline: &str) -> Result<(), PinFailure> {
            self.inserted += 1;
            if !self.ignore {
                self.value.push_str(text);
            }
            Ok(())
        }
    }
    fn field(value: &str) -> Field {
        Field {
            value: value.into(),
            range: (0, 0),
            ignore: false,
            edit: false,
            inserted: 0,
            checkpoint_edit: Default::default(),
        }
    }
    #[test]
    fn append_uses_utf16_and_preserves_unicode() {
        let mut f = field("😀 ");
        let out = append_verified(&mut f, "résumé 🐈", || true, |_, _| Ok(()));
        assert_eq!(out.state, DeliveryState::Delivered);
        assert_eq!(f.range, (3, 0));
        assert_eq!(f.value, "😀 résumé 🐈");
    }
    #[test]
    fn accepted_but_ignored_write_is_uncertain_and_not_retryable() {
        let mut f = field("before");
        f.ignore = true;
        let out = append_verified(&mut f, "after", || true, |_, _| Ok(()));
        assert_eq!(out.state, DeliveryState::Uncertain);
        assert!(out.may_have_written);
    }
    #[test]
    fn concurrent_edit_prevents_mutation() {
        let mut f = field("before");
        f.edit = true;
        let out = append_verified(&mut f, "after", || true, |_, _| Ok(()));
        assert_eq!(out.reason, Some(PinFailure::ValueChanged));
        assert!(!out.may_have_written);
        assert_eq!(f.inserted, 0);
    }
    #[test]
    fn failed_durable_checkpoint_prevents_write() {
        let mut f = field("");
        let out = append_verified(
            &mut f,
            "result",
            || true,
            |_, _| Err(PinFailure::HistorySaveFailed),
        );
        assert_eq!(f.inserted, 0);
        assert_eq!(out.state, DeliveryState::Deferred);
    }
    #[test]
    fn value_or_selection_changes_during_checkpoint_prevent_write() {
        for change in [1, 2] {
            let mut f = field("before");
            let edit = f.checkpoint_edit.clone();
            let out = append_verified(
                &mut f,
                "after",
                || true,
                |_, _| {
                    edit.set(change);
                    Ok(())
                },
            );
            assert_eq!(out.reason, Some(PinFailure::ValueChanged));
            assert_eq!(out.state, DeliveryState::Deferred);
            assert!(!out.may_have_written);
            assert_eq!(f.inserted, 0);
        }
    }
    #[test]
    fn clearing_after_first_chunk_preserves_partial_progress() {
        use std::cell::Cell;
        let valid = Cell::new(true);
        let text = "😀".repeat(CHUNK_UTF16);
        let mut f = field("");
        let out = append_verified(
            &mut f,
            &text,
            || valid.get(),
            |n, _| {
                if n > 0 {
                    valid.set(false);
                }
                Ok(())
            },
        );
        assert_eq!(out.state, DeliveryState::Partial);
        assert_eq!(out.confirmed_utf16, CHUNK_UTF16);
        assert_eq!(f.inserted, 1);
    }
    #[test]
    fn cancelled_before_insertion_is_safe() {
        let mut f = field("");
        let out = append_verified(&mut f, "result", || false, |_, _| Ok(()));
        assert_eq!(out.state, DeliveryState::Cancelled);
        assert!(!out.may_have_written);
    }
}
