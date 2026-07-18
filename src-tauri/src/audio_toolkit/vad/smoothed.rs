use super::{VadFrame, VoiceActivityDetector};
use anyhow::Result;
use std::collections::VecDeque;

pub struct SmoothedVad {
    inner_vad: Box<dyn VoiceActivityDetector>,
    prefill_frames: usize,
    hangover_frames: usize,
    onset_frames: usize,

    frame_buffer: VecDeque<Vec<f32>>,
    hangover_counter: usize,
    onset_counter: usize,
    in_speech: bool,

    temp_out: Vec<f32>,
}

impl SmoothedVad {
    pub fn new(
        inner_vad: Box<dyn VoiceActivityDetector>,
        prefill_frames: usize,
        hangover_frames: usize,
        onset_frames: usize,
    ) -> Self {
        Self {
            inner_vad,
            prefill_frames,
            hangover_frames,
            onset_frames,
            frame_buffer: VecDeque::new(),
            hangover_counter: 0,
            onset_counter: 0,
            in_speech: false,
            temp_out: Vec::new(),
        }
    }
}

impl VoiceActivityDetector for SmoothedVad {
    fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> Result<VadFrame<'a>> {
        // 1. Buffer every incoming frame for possible pre-roll
        self.frame_buffer.push_back(frame.to_vec());
        while self.frame_buffer.len() > self.prefill_frames + 1 {
            self.frame_buffer.pop_front();
        }

        // 2. Delegate to the wrapped boolean VAD
        let is_voice = self.inner_vad.is_voice(frame)?;

        match (self.in_speech, is_voice) {
            // Potential start of speech - need to accumulate onset frames
            (false, true) => {
                self.onset_counter += 1;
                if self.onset_counter >= self.onset_frames {
                    // We have enough consecutive voice frames to trigger speech
                    self.in_speech = true;
                    self.hangover_counter = self.hangover_frames;
                    self.onset_counter = 0; // Reset for next time

                    // Collect prefill + current frame
                    self.temp_out.clear();
                    for buf in &self.frame_buffer {
                        self.temp_out.extend(buf);
                    }
                    Ok(VadFrame::Speech(&self.temp_out))
                } else {
                    // Not enough frames yet, still silence
                    Ok(VadFrame::Noise)
                }
            }

            // Ongoing Speech
            (true, true) => {
                self.hangover_counter = self.hangover_frames;
                Ok(VadFrame::Speech(frame))
            }

            // End of Speech or interruption during onset phase
            (true, false) => {
                if self.hangover_counter > 0 {
                    self.hangover_counter -= 1;
                    Ok(VadFrame::Speech(frame))
                } else {
                    self.in_speech = false;
                    Ok(VadFrame::Noise)
                }
            }

            // Silence or broken onset sequence
            (false, false) => {
                self.onset_counter = 0; // Reset onset counter on silence
                Ok(VadFrame::Noise)
            }
        }
    }

    fn reset(&mut self) {
        // The wrapped Silero model is recurrent. Resetting only this smoothing
        // layer leaves its hidden state frozen at the end of the previous
        // utterance, which can make a later short phrase look like noise.
        self.inner_vad.reset();
        self.frame_buffer.clear();
        self.hangover_counter = 0;
        self.onset_counter = 0;
        self.in_speech = false;
        self.temp_out.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::SmoothedVad;
    use crate::audio_toolkit::vad::{VadFrame, VoiceActivityDetector};
    use anyhow::Result;
    use std::sync::{Arc, Mutex};

    struct ResetTrackingVad {
        reset_count: Arc<Mutex<usize>>,
    }

    impl VoiceActivityDetector for ResetTrackingVad {
        fn push_frame<'a>(&'a mut self, frame: &'a [f32]) -> Result<VadFrame<'a>> {
            Ok(VadFrame::Speech(frame))
        }

        fn reset(&mut self) {
            let mut count = self.reset_count.lock().unwrap();
            *count += 1;
        }
    }

    #[test]
    fn reset_propagates_to_the_recurrent_detector() {
        let reset_count = Arc::new(Mutex::new(0));
        let inner = ResetTrackingVad {
            reset_count: Arc::clone(&reset_count),
        };
        let mut vad = SmoothedVad::new(Box::new(inner), 15, 15, 2);

        vad.reset();

        assert_eq!(*reset_count.lock().unwrap(), 1);
    }
}
