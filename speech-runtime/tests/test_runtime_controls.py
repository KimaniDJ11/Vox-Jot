import unittest

from runtime.config import ENGINE_SPECS
from runtime.control_mapping import map_controls_for_engine, normalize_controls


class RuntimeControlsTest(unittest.TestCase):
    def test_normalize_controls_reads_nested_tuning_payload(self):
        controls = normalize_controls(
            {
                "tuning": {
                    "tempo_rate": 1.4,
                    "expressiveness": 0.6,
                    "randomness": 0.25,
                    "guidance": 0.85,
                    "repetition_penalty": 1.9,
                    "style_instructions": " calm and bright ",
                }
            }
        )

        self.assertEqual(controls["tempo_rate"], 1.4)
        self.assertEqual(controls["guidance"], 0.85)
        self.assertEqual(controls["repetition_penalty"], 1.9)
        self.assertEqual(controls["style_instructions"], "calm and bright")

    def test_chatterbox_mapping_uses_guidance_and_randomness(self):
        mapped = map_controls_for_engine(
            "chatterbox",
            {
                "tempo_rate": 1.0,
                "expressiveness": 0.55,
                "exaggeration": 0.8,
                "randomness": 0.35,
                "guidance": 0.9,
                "repetition_penalty": 1.7,
            },
        )

        self.assertEqual(mapped["cfg_weight"], 0.9)
        self.assertEqual(mapped["temperature"], 0.35)
        self.assertEqual(mapped["exaggeration"], 0.8)
        self.assertEqual(mapped["repetition_penalty"], 1.7)

    def test_chatterbox_turbo_is_cataloged_as_clone_and_tag_capable(self):
        spec = next(spec for spec in ENGINE_SPECS if spec.model_id == "chatterbox-turbo")

        self.assertEqual(spec.provider_id, "chatterbox")
        self.assertEqual(spec.license_label, "MIT")
        self.assertTrue(spec.supports_voice_cloning)
        self.assertTrue(spec.supports_inline_tags)
        self.assertIn("chatterbox-turbo/chatterbox-turbo", spec.model_dirs)

    def test_unsupported_fields_are_ignored_for_openvoice(self):
        mapped = map_controls_for_engine(
            "openvoice",
            {
                "tempo_rate": 1.3,
                "guidance": 0.9,
                "randomness": 0.2,
            },
        )

        self.assertEqual(mapped, {"speed": 1.3})


if __name__ == "__main__":
    unittest.main()
