## Audio Test Bank (Post-Process)

This folder is a **curated index** of high-variety audio sources you can use to test Vox Jot’s **post-processing** (and the full dictation pipeline) across realistic conditions:

- Clean speech (baseline)
- Accents + multilingual
- Far-field / meeting audio
- Telephony / low-bitrate
- Noisy / reverberant / mixed audio
- Emotional / expressive speech
- Non-speech event audio (false-positive / segmentation stress)
- Speech disorders (hard-mode robustness)

It intentionally does **not** download anything automatically. Many datasets are huge, gated, or have non-commercial terms. Instead, use the manifests here to pick what you need, then download subsets manually.

### Files

- `manifest.csv`: source index (easy filtering in Excel/Sheets)
- `manifest.json`: same content (programmatic use)
- `post-process-test-matrix.md`: a systematic checklist for stress-testing post-process behavior

### Recommended “starter mix” (fastest variety per GB)

If you only grab a few:

- **LibriSpeech test-clean/test-other** (baseline + harder read speech): `https://www.openslr.org/12/`
- **VCTK** (English accents across many speakers): `https://datashare.ed.ac.uk/handle/10283/3443`
- **AMI meetings (mix + lapels)** (overlap, meeting cadence): `http://groups.inf.ed.ac.uk/ami/download/`
- **DNS Challenge noise + RIR** (synthetic noisy variants): `https://github.com/microsoft/DNS-Challenge/`
- **MUSAN** (noise/music/speech beds): `http://www.openslr.org/17`
- **Common Voice** (real-world crowd speech in many languages): `https://datacollective.mozillafoundation.org/datasets?q=Common+Voice+Corpus`
