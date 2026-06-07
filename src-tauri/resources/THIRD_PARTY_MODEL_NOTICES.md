# Vox Jot Third-Party Model Notices

This file tracks third-party model, runtime, and model-asset notices for Vox Jot.
It is bundled with the app resources and should be published next to release
downloads. The structured source of truth is `models.licenses.json`.

Vox Jot does not claim ownership of third-party model weights. Unless a model is
listed as a platform runtime, Vox Jot either downloads the upstream model
directly or mirrors/converts assets for app-managed installation.

## Notice Rules

- MIT/BSD/Apache-2.0 models: preserve copyright and license text.
- CC-BY models: preserve attribution, license link, source link, and note any
  conversion or mirror performed by Vox Jot.
- Gated models: require the user to accept the upstream provider terms before
  download.
- Non-commercial, research-only, custom, or unknown licenses are not covered by
  the "allowed with obligations" group and require separate legal/product review.
- Voice cloning models require user permission for any reference voice sample,
  regardless of the model license.

## Speech-to-Text And File ASR

- OpenAI Whisper / whisper.cpp assets - MIT. Sources:
  https://github.com/openai/whisper and
  https://huggingface.co/ggerganov/whisper.cpp.
- NVIDIA Parakeet - CC-BY-4.0 attribution required. Source:
  https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3. Vox Jot may distribute
  converted or quantized assets through its managed model mirror.
- Useful Sensors Moonshine - MIT. Source:
  https://huggingface.co/UsefulSensors/moonshine.
- FunAudioLLM SenseVoice Small - custom model license requiring review before
  normal commercial distribution. Source:
  https://huggingface.co/FunAudioLLM/SenseVoiceSmall.
- GigaAM v3 - MIT. Source: https://huggingface.co/ai-sage/GigaAM-v3.
- Breeze ASR 25 whisper.cpp conversion - Apache-2.0. Source:
  https://huggingface.co/alan314159/Breeze-ASR-25-whispercpp.
- Qwen3 ASR MLX conversions - Apache-2.0. Sources:
  https://huggingface.co/Qwen and
  https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit.
- FireRedASR2 AED MLX conversion - Apache-2.0 per current catalog policy.
  Source: https://huggingface.co/mlx-community/FireRedASR2-AED-mlx.
- Microsoft VibeVoice ASR MLX conversion - MIT. Source:
  https://huggingface.co/mlx-community/VibeVoice-ASR-bf16.
- Google Gemma 4 E2B/E4B Audio - Apache-2.0 with Gemma terms. Sources:
  https://huggingface.co/google/gemma-4-E2B-it,
  https://huggingface.co/google/gemma-4-E4B-it, and
  https://huggingface.co/mlx-community/gemma-4-e2b-it-4bit.
- NVIDIA Nemotron 3.5 ASR Streaming MLX conversion - NVIDIA Open Model
  License; requires legal/product review before normal commercial
  distribution. Sources:
  https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b and
  https://huggingface.co/mlx-community/nemotron-3.5-asr-streaming-0.6b.
- Mega-ASR 8-bit MLX conversion - Apache-2.0. Sources:
  https://huggingface.co/zhifeixie/Mega-ASR,
  https://huggingface.co/Qwen/Qwen3-ASR-1.7B, and
  https://huggingface.co/mlx-community/Mega-ASR-8bit.
- Apple SpeechAnalyzer - platform runtime governed by Apple platform terms.

## Speech Analysis And Speaker Isolation

- IBM Granite Speech 4.1 2B - Apache-2.0. Source:
  https://huggingface.co/ibm-granite/granite-speech-4.1-2b.
- Cohere Transcribe 03-2026 - Apache-2.0 with gated provider terms. Source:
  https://huggingface.co/CohereLabs/cohere-transcribe-03-2026.
- pyannote Speaker Diarization Community-1 - CC-BY-4.0 attribution required
  and gated Hugging Face terms apply. Source:
  https://huggingface.co/pyannote/speaker-diarization-community-1.
- pyannote Speaker Diarization 3.1 - MIT and gated Hugging Face terms apply.
  Source: https://huggingface.co/pyannote/speaker-diarization-3.1.
- NVIDIA Sortformer v2.1 MLX conversion - CC-BY-4.0 attribution required.
  Sources:
  https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1 and
  https://huggingface.co/mlx-community/diar_streaming_sortformer_4spk-v2.1-fp16.
- NVIDIA Sortformer v1 - CC-BY-NC-4.0; gated before download for
  non-commercial terms acknowledgement. Sources:
  https://huggingface.co/nvidia/diar_sortformer_4spk-v1 and
  https://huggingface.co/mlx-community/diar_sortformer_4spk-v1-fp16.
- Rev.ai Reverb Diarization V2 - custom/gated terms; gated before download.
  Source: https://huggingface.co/Revai/reverb-diarization-v2.
- Polyvoice ONNX diarization uses WeSpeaker embeddings and Silero VAD assets.
  WeSpeaker source: https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34.

## Text-to-Speech

- Qwen3 TTS - Apache-2.0. Source:
  https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base.
- OpenVoice - MIT. Source: https://github.com/myshell-ai/OpenVoice.
- Coqui XTTS v2 - Coqui Public Model License; gated before download for
  non-commercial terms and reference-voice consent. Source:
  https://huggingface.co/coqui/XTTS-v2.
- Supertonic 3 - OpenRAIL-M; requires legal/product review before normal
  commercial distribution. Source: https://huggingface.co/supertone/supertonic-3.
- Resemble AI Chatterbox - MIT. Source:
  https://huggingface.co/ResembleAI/chatterbox.
- Kokoro - Apache-2.0. Sources:
  https://huggingface.co/hexgrad/Kokoro-82M and
  https://huggingface.co/mlx-community/Kokoro-82M-bf16.
- Dia - Apache-2.0. Source:
  https://huggingface.co/mlx-community/Dia-1.6B-fp16.
- Sesame CSM - Apache-2.0. Source:
  https://huggingface.co/mlx-community/csm-1b.
- Spark TTS - CC-BY-NC-SA-4.0; gated before download for non-commercial terms.
  Source: https://huggingface.co/mlx-community/Spark-TTS-0.5B-bf16.
- Llama OuteTTS - CC-BY-NC-SA-4.0; gated before download for non-commercial
  terms and reference-voice consent. Source:
  https://huggingface.co/mlx-community/Llama-OuteTTS-1.0-1B-4bit.
- Ming Omni TTS - Apache-2.0. Source:
  https://huggingface.co/mlx-community/Ming-omni-tts-0.5B-4bit.
- KugelAudio - MIT. Source:
  https://huggingface.co/kugelaudio/kugelaudio-0-open.
- Bark Small MLX conversion - MIT. Source:
  https://huggingface.co/mlx-community/bark-small.
- Fish Audio S2 Pro - Fish Audio Research License; gated before download and
  commercial use requires a separate license. Source:
  https://huggingface.co/mlx-community/fish-audio-s2-pro-bf16.
- Liquid LFM2.5 Audio 1.5B - LFM Open License v1.0; gated before download for
  custom license review. Source:
  https://huggingface.co/mlx-community/LFM2.5-Audio-1.5B-bf16.
- LongCat AudioDiT - MIT. Source:
  https://huggingface.co/mlx-community/LongCat-AudioDiT-1B-4bit.
- Soprano - Apache-2.0. Source:
  https://huggingface.co/mlx-community/Soprano-80M-4bit.
- MeloTTS English MLX - MIT. Source:
  https://huggingface.co/mlx-community/MeloTTS-English-MLX.
- Higgs Audio v2 - Apache-2.0. Source:
  https://huggingface.co/mlx-community/higgs-audio-v2-3B-mlx-q8.
- MOSS-TTS Nano - Apache-2.0. Source:
  https://huggingface.co/mlx-community/MOSS-TTS-Nano-100M.
- Irodori TTS - MIT. Source:
  https://huggingface.co/mlx-community/Irodori-TTS-500M-v2-4bit.
- IndexTTS - Apache-2.0. Source:
  https://huggingface.co/mlx-community/IndexTTS-1.5.
- OmniVoice - Apache-2.0. Source:
  https://huggingface.co/k2-fsa/OmniVoice.
- KittenTTS 0.8 MLX conversions - Apache-2.0. Sources:
  https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32,
  https://huggingface.co/mlx-community/kitten-tts-nano-0.8,
  https://huggingface.co/mlx-community/kitten-tts-micro-0.8, and
  https://huggingface.co/mlx-community/kitten-tts-mini-0.8.
- MisoLabs MisoTTS MLX conversions - Modified MIT; requires legal/product
  review before normal commercial distribution. Sources:
  https://huggingface.co/MisoLabs/MisoTTS,
  https://huggingface.co/mlx-community/MisoLabs-MisoTTS-8bit, and
  https://huggingface.co/mlx-community/MisoLabs-MisoTTS-bf16.
- VibeVoice Realtime - MIT. Source:
  https://huggingface.co/mlx-community/VibeVoice-Realtime-0.5B-4bit.
- Voxtral TTS - CC-BY-NC-4.0; gated before download for non-commercial terms.
  Source: https://huggingface.co/mlx-community/Voxtral-4B-TTS-2603-mlx-bf16.
- VoxCPM2 - Apache-2.0. Source:
  https://huggingface.co/mlx-community/VoxCPM2-8bit.
- Pocket TTS - CC-BY-4.0 attribution required. Source:
  https://huggingface.co/mlx-community/pocket-tts.
- k2-fsa sherpa-onnx TTS runtime and VITS voice packs - preserve upstream
  runtime and voice-pack notices. Sources:
  https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.20 and
  https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models.

## OCR

- PaddlePaddle PP-OCRv5 - Apache-2.0. Source:
  https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_safetensors.
- LightOnOCR-2 1B - Apache-2.0. Source:
  https://huggingface.co/lightonai/LightOnOCR-2-1B.
- Allen AI olmOCR-2 7B - Apache-2.0. Source:
  https://huggingface.co/allenai/olmOCR-2-7B-1025.
- GLM-OCR - MIT. Source: https://huggingface.co/zai-org/GLM-OCR.
- Chandra OCR 2 - Modified OpenRAIL-M; gated before download for custom license
  review. Source: https://huggingface.co/datalab-to/chandra-ocr-2.
- Qwen2.5-VL OCR - Qwen Research License; gated before download for
  non-commercial terms. Source:
  https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct.
- Tesseract tessdata_best - Apache-2.0. Source:
  https://github.com/tesseract-ocr/tessdata_best.

## Known Review-Required Models

The following catalog rows need legal/product review before normal commercial
distribution or should be explicitly gated: XTTS v2, Fish Audio S2 Pro, Spark
TTS, Llama OuteTTS, Voxtral TTS, NVIDIA Sortformer v1, NVIDIA Nemotron 3.5
ASR, MisoTTS, Chandra OCR 2, Qwen2.5-VL OCR, Reverb Diarization V2, LFM Audio,
and any row whose current license is `Other`, `Custom`, `Research-only`, or
missing.
