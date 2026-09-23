import json
import tempfile
import unittest
from pathlib import Path

from runtime.selection import RuntimeSelection, load_selection


class RuntimeSelectionTest(unittest.TestCase):
    def test_non_object_json_is_treated_as_an_empty_selection(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            selection_path = Path(temporary_dir) / "selection.json"
            for payload in ([], None, 7, "profile"):
                with self.subTest(payload=payload):
                    selection_path.write_text(json.dumps(payload), encoding="utf-8")
                    self.assertEqual(load_selection(selection_path), RuntimeSelection())

    def test_selection_ignores_non_string_fields_and_normalizes_strings(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            selection_path = Path(temporary_dir) / "selection.json"
            selection_path.write_text(
                json.dumps(
                    {
                        "provider_id": ["openvoice"],
                        "model_id": " chatterbox ",
                        "profile_id": 42,
                    }
                ),
                encoding="utf-8",
            )

            self.assertEqual(
                load_selection(selection_path),
                RuntimeSelection(model_id="chatterbox"),
            )


if __name__ == "__main__":
    unittest.main()
