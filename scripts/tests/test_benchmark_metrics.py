from __future__ import annotations

import importlib.util
import csv
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "run-speaker-isolation-eval.py"
SPEC = importlib.util.spec_from_file_location("speaker_eval", SCRIPT)
assert SPEC and SPEC.loader
speaker_eval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(speaker_eval)

TTS_SCRIPT = Path(__file__).resolve().parents[1] / "run-tts-model-eval.py"
TTS_SPEC = importlib.util.spec_from_file_location("tts_eval", TTS_SCRIPT)
assert TTS_SPEC and TTS_SPEC.loader
tts_eval = importlib.util.module_from_spec(TTS_SPEC)
sys.modules[TTS_SPEC.name] = tts_eval
TTS_SPEC.loader.exec_module(tts_eval)


class SpeakerIsolationMetricsTests(unittest.TestCase):
    def test_mapping_is_one_to_one(self) -> None:
        mapping = speaker_eval.optimal_cluster_map(
            ["P0", "P1"],
            ["A", "B"],
            {
                ("P0", "A"): 900,
                ("P0", "B"): 800,
                ("P1", "A"): 850,
                ("P1", "B"): 0,
            },
        )
        self.assertEqual(mapping, {"P0": "B", "P1": "A"})

    def test_perfect_turns_have_zero_der_and_jer(self) -> None:
        truth = [
            {"speaker_id": "A", "start_ms": 0, "end_ms": 1_000},
            {"speaker_id": "B", "start_ms": 1_000, "end_ms": 2_000},
        ]
        predicted = [
            {"speaker_id": "P1", "start_ms": 0, "end_ms": 1_000},
            {"speaker_id": "P0", "start_ms": 1_000, "end_ms": 2_000},
        ]
        result = speaker_eval.score_turns(predicted, truth)
        self.assertEqual(result["der"], 0.0)
        self.assertEqual(result["jaccard_error_rate"], 0.0)
        self.assertEqual(result["speaker_mapping_method"], "optimal_speaker_mapping_v2")

    def test_missed_speech_contributes_to_der(self) -> None:
        truth = [{"speaker_id": "A", "start_ms": 0, "end_ms": 1_000}]
        predicted = [{"speaker_id": "P0", "start_ms": 0, "end_ms": 500}]
        result = speaker_eval.score_turns(predicted, truth)
        self.assertEqual(result["missed_speech_rate"], 0.5)
        self.assertEqual(result["der"], 0.5)


class TtsListenerRatingTests(unittest.TestCase):
    def test_blind_listener_panel_is_ingested_and_normalized(self) -> None:
        fieldnames = [
            "listener_id",
            "blind_assignment_id",
            "model_id",
            "case_id",
            "style_match_1_to_5",
            "naturalness_1_to_5",
            "intelligibility_1_to_5",
            "listening_fatigue_1_to_5",
            "overall_preference_1_to_5",
        ]
        with tempfile.NamedTemporaryFile(mode="w", newline="", suffix=".csv") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for listener_id, rating in (("L1", 5), ("L2", 3), ("L3", 4)):
                writer.writerow(
                    {
                        "listener_id": listener_id,
                        "blind_assignment_id": f"blind-{listener_id}",
                        "model_id": "model-a",
                        "case_id": "case-a",
                        "style_match_1_to_5": rating,
                        "naturalness_1_to_5": rating,
                        "intelligibility_1_to_5": rating,
                        "listening_fatigue_1_to_5": rating,
                        "overall_preference_1_to_5": rating,
                    }
                )
            handle.flush()
            results = [
                {
                    "model_id": "model-a",
                    "cases": [{"case_id": "case-a", "status": "tested"}],
                }
            ]
            status = tts_eval.apply_listener_ratings(
                results, handle.name, "style", minimum_listeners=3
            )

        self.assertTrue(status["complete"])
        preference = results[0]["cases"][0]["listener_preference"]
        self.assertEqual(preference["listener_count"], 3)
        self.assertEqual(preference["overall_preference_normalized"], 0.75)


if __name__ == "__main__":
    unittest.main()
