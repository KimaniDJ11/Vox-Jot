//! Preserve a completed transcript when the queued output callback is dropped
//! or exits before it can report a delivery outcome.

use super::DeferredHistorySave;

pub(super) struct HistorySaveGuard<F: FnOnce(DeferredHistorySave)> {
    request: Option<DeferredHistorySave>,
    save: Option<F>,
}

impl<F: FnOnce(DeferredHistorySave)> HistorySaveGuard<F> {
    pub(super) fn new(request: DeferredHistorySave, save: F) -> Self {
        Self {
            request: Some(request),
            save: Some(save),
        }
    }

    pub(super) fn finish(mut self, delivered: bool) {
        self.save_once(delivered);
    }

    fn save_once(&mut self, delivered: bool) {
        if let (Some(mut request), Some(save)) = (self.request.take(), self.save.take()) {
            if !delivered {
                request.pasted_text = None;
            }
            save(request);
        }
    }
}

impl<F: FnOnce(DeferredHistorySave)> Drop for HistorySaveGuard<F> {
    fn drop(&mut self) {
        self.save_once(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managers::history::TranslationHistoryContext;
    use crate::tts::TtsHistoryContext;
    use std::sync::{mpsc, Arc};

    fn request() -> DeferredHistorySave {
        DeferredHistorySave {
            audio_samples: Arc::new(vec![0.1, 0.2]),
            transcription_text: "Keep this transcript".into(),
            post_processed_text: Some("Keep this transcript.".into()),
            post_process_prompt: None,
            dictionary_hits: vec![],
            pasted_text: Some("Keep this transcript.".into()),
            translation_context: TranslationHistoryContext::default(),
            tts_context: TtsHistoryContext::default(),
            screen_context_metadata: None,
            field_snapshot_app_id: Some("com.apple.TextEdit".into()),
        }
    }

    #[test]
    fn rejected_output_callback_preserves_history_without_claiming_delivery() {
        let (tx, rx) = mpsc::channel();
        let request = request();
        let audio = Arc::clone(&request.audio_samples);
        let guard = HistorySaveGuard::new(request, move |request| tx.send(request).unwrap());
        // A rejected run_on_main_thread dispatch drops its callback without
        // ever executing it. Exercise that ownership path, not just Drop.
        let callback = move || guard.finish(true);
        drop(callback);
        let saved = rx.recv().unwrap();
        assert_eq!(saved.transcription_text, "Keep this transcript");
        assert_eq!(
            saved.post_processed_text.as_deref(),
            Some("Keep this transcript.")
        );
        assert!(Arc::ptr_eq(&saved.audio_samples, &audio));
        assert!(saved.pasted_text.is_none());
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn cancelled_output_callback_saves_once_without_claiming_delivery() {
        let (tx, rx) = mpsc::channel();
        let guard = HistorySaveGuard::new(request(), move |request| tx.send(request).unwrap());
        let callback = move || {
            let _guard = guard;
            // An early cancellation return must still preserve the result.
        };
        callback();
        assert!(rx.recv().unwrap().pasted_text.is_none());
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn successful_output_saves_the_delivered_text_exactly_once() {
        let (tx, rx) = mpsc::channel();
        HistorySaveGuard::new(request(), move |request| tx.send(request).unwrap()).finish(true);
        assert_eq!(
            rx.recv().unwrap().pasted_text.as_deref(),
            Some("Keep this transcript.")
        );
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn failed_output_saves_the_result_exactly_once() {
        let (tx, rx) = mpsc::channel();
        HistorySaveGuard::new(request(), move |request| tx.send(request).unwrap()).finish(false);
        let saved = rx.recv().unwrap();
        assert_eq!(saved.transcription_text, "Keep this transcript");
        assert!(saved.pasted_text.is_none());
        assert!(rx.try_recv().is_err());
    }
}
