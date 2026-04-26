use crate::apple_intelligence;
use crate::helpers::subtitles::TimedSegment;
use anyhow::Result;

#[derive(Debug, Clone, Copy)]
pub enum AppleSpeechMode {
    Offline,
    Progressive,
}

#[derive(Debug)]
pub struct AppleSpeechEngine {
    mode: AppleSpeechMode,
}

impl AppleSpeechEngine {
    pub fn new(mode: AppleSpeechMode) -> Result<Self> {
        if !apple_intelligence::check_apple_speech_analyzer_availability() {
            return Err(anyhow::anyhow!(
                "Apple SpeechAnalyzer requires macOS 26 or newer and a build made with the macOS 26 SDK."
            ));
        }
        Ok(Self { mode })
    }

    pub fn transcribe(
        &self,
        audio: &[f32],
        sample_rate: u32,
        language: Option<&str>,
    ) -> Result<(String, Vec<TimedSegment>)> {
        let payload = apple_intelligence::transcribe_with_apple_speech_analyzer(
            audio,
            sample_rate,
            language,
            matches!(self.mode, AppleSpeechMode::Progressive),
        )
        .map_err(|err| anyhow::anyhow!(err))?;
        Ok((payload.text, payload.segments))
    }
}
