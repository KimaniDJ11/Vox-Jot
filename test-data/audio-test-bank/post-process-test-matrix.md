## Post-Process Test Matrix

This matrix is designed to **stress Vox Jot post-processing** across realistic audio conditions and predictable failure modes.

### What to capture for each run

- **Input**: dataset/source, clip length, language, recording condition (clean/noisy/telephony/far-field), SNR (if synthetic)
- **Model**: STT model + settings, post-process on/off, any enhancement toggles
- **Output**: raw transcript vs post-processed text, plus a quick verdict
- **Failures**: examples (copy/paste 1–3 lines), not just “it was bad”

### Scoring (quick + practical)

- **0 = Broken**: unusable output, repeated garbage, or crashes/hangs
- **1 = Poor**: many errors; post-process makes it worse
- **2 = OK**: understandable; post-process mostly helps
- **3 = Great**: clean, stable, and consistent formatting

### Core dimensions to cover

#### Audio condition (choose at least 2 clips each)

- **Clean**: LibriSpeech `test-clean`, Mini LibriSpeech
- **Accent (English)**: VCTK (same prompt across multiple speakers)
- **Multilingual**: Common Voice + FLEURS (pick 3 languages)
- **Noisy**: CHiME-4 real; WHAM! mixtures; DNS synthetic
- **Reverb**: DNS + RIR mixes (or any room recordings)
- **Far-field / meetings**: AMI headset mix vs array (or SDM)
- **Telephony**: Switchboard/Fisher/CALLHOME (if you have LDC)
- **Emotional**: RAVDESS; IEMOCAP (if available)
- **Non-speech**: UrbanSound8K / ESC-50 / FSD50K
- **Hard articulation**: TORGO / UASpeech (if available)

#### Clip length buckets

- **Short**: 1–5s (keyword-ish / quick utterances)
- **Medium**: 10–30s (typical dictation fragments)
- **Long**: 60–180s (chunking + consistency + drift)

#### Content styles

- **Numbers**: dates, times, money, addresses (“123B”, “5:30”, “$19.99”)
- **Punctuation triggers**: questions, lists, abbreviations (“U.S.”, “Dr.”)
- **Names**: people + places, uncommon spellings
- **Code-ish**: filenames, URLs, email addresses (should avoid “helpful” corruption)
- **Disfluency**: “um”, “uh”, restarts, corrections mid-sentence
- **Overlapping speakers** (meetings): two speakers talking over each other

### Test suites (pick based on how deep you want to go)

#### Suite A — 30 minutes (sanity)

- 5 clean clips (10–30s)
- 3 accent clips (VCTK)
- 3 noisy clips (1 CHiME real, 1 WHAM, 1 DNS synthetic)
- 2 far-field meeting clips (AMI mix)
- 2 non-speech clips (ESC-50 / UrbanSound8K)

Pass criteria:

- Post-process **never** turns understandable text into nonsense.
- Non-speech **does not** produce confident long transcripts.

#### Suite B — 2 hours (coverage)

- 10 clean (mix short/medium/long)
- 10 noisy (SNR ladder if synthetic: +20, +10, +5, 0 dB)
- 6 far-field/meeting (headset vs array where possible)
- 6 telephony (if available)
- 6 multilingual (2 clips each in 3 languages)
- 4 emotional
- 6 non-speech

Pass criteria:

- Formatting is stable (capitalization, punctuation, spacing).
- Post-process improvements are consistent across conditions.
- No systematic failure mode (e.g., “adds random periods every 2–3 words”).

#### Suite C — “Break it” weekend

Goal: intentionally find edge-case regressions.

- 50+ clips with a bias toward: far-field overlap, heavy noise, low bitrate audio, and long-form.
- Include at least 10 “weird” items:
  - clipped audio
  - extremely quiet audio
  - background TV speech
  - music with vocals
  - sirens + speech
  - laughter + speech
  - whispering
  - rapid speech
  - strong reverb
  - multiple languages in one clip (code switching)

Pass criteria:

- App stays responsive; no hangs; no runaway CPU usage.
- Post-process fails “gracefully” (minor formatting issues) rather than catastrophic distortion.

### Suggested “golden” baselines

Keep a small set of clips you re-run after changes:

- 5× Mini LibriSpeech (already aligns with your regression pack style)
- 3× VCTK (same sentence, 3 accents)
- 2× AMI meeting overlap
- 3× DNS synthetic at different SNRs (+10, +5, 0 dB)
- 2× Non-speech (siren, keyboard typing)
