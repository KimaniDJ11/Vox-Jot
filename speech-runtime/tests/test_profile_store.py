import os
import tempfile
import unittest
from pathlib import Path

from runtime.profile_store import ProfileStoreError, load_profile_from_store


PROFILE_ID = "550e8400-e29b-41d4-a716-446655440000"


class ProfileStoreTest(unittest.TestCase):
    def make_symlink(
        self,
        target: Path,
        link: Path,
        *,
        target_is_directory: bool = False,
    ) -> None:
        try:
            os.symlink(target, link, target_is_directory=target_is_directory)
        except OSError as exc:
            self.skipTest(f"symbolic links are unavailable: {exc}")

    def make_root(self, temporary_dir: str) -> Path:
        return Path(temporary_dir) / "app-data" / "tts" / "profiles"

    def make_profile(self, profiles_root: Path) -> Path:
        profile_dir = profiles_root / PROFILE_ID
        profile_dir.mkdir(parents=True)
        (profile_dir / "profile.json").write_text(
            '{"id":"%s","transcript":"Reference words"}' % PROFILE_ID,
            encoding="utf-8",
        )
        (profile_dir / "reference.wav").write_bytes(b"wave fixture")
        return profile_dir

    def test_normal_profile_store_loads_reference_and_transcript(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)
            profile_dir = self.make_profile(profiles_root)

            reference, transcript = load_profile_from_store(profiles_root, PROFILE_ID)

            self.assertEqual(reference, str(profile_dir / "reference.wav"))
            self.assertEqual(transcript, "Reference words")

    def test_missing_profile_store_returns_no_profile(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)

            self.assertEqual(
                load_profile_from_store(profiles_root, PROFILE_ID),
                (None, None),
            )

    def test_profile_id_must_be_a_canonical_uuid_even_without_a_store(self):
        invalid_ids = (
            "../outside",
            "/tmp/outside",
            "550e8400e29b41d4a716446655440000",
            "550E8400-E29B-41D4-A716-446655440000",
            " 550e8400-e29b-41d4-a716-446655440000 ",
            "not-a-uuid",
        )

        for profile_id in invalid_ids:
            with self.subTest(profile_id=profile_id):
                with self.assertRaisesRegex(ProfileStoreError, "canonical UUID"):
                    load_profile_from_store(None, profile_id)

    def test_profile_metadata_id_must_match_directory(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)
            profile_dir = self.make_profile(profiles_root)
            (profile_dir / "profile.json").write_text(
                '{"id":"67e55044-10b1-426f-9247-bb680e5fe0c8",'
                '"transcript":"wrong profile"}',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ProfileStoreError, "does not match"):
                load_profile_from_store(profiles_root, PROFILE_ID)

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_tts_storage_directory_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            base = Path(temporary_dir)
            app_data = base / "app-data"
            outside = base / "outside"
            app_data.mkdir()
            outside.mkdir()
            self.make_symlink(outside, app_data / "tts", target_is_directory=True)

            with self.assertRaisesRegex(
                ProfileStoreError,
                "TTS storage directory.*symbolic link",
            ):
                load_profile_from_store(app_data / "tts" / "profiles", PROFILE_ID)

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_profiles_storage_directory_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)
            outside = Path(temporary_dir) / "outside"
            profiles_root.parent.mkdir(parents=True)
            outside.mkdir()
            self.make_symlink(outside, profiles_root, target_is_directory=True)

            with self.assertRaisesRegex(
                ProfileStoreError,
                "TTS profile storage directory.*symbolic link",
            ):
                load_profile_from_store(profiles_root, PROFILE_ID)

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_profile_directory_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)
            outside = Path(temporary_dir) / "outside"
            profiles_root.mkdir(parents=True)
            self.make_profile(outside.parent / "outside-store")
            outside_profile = outside.parent / "outside-store" / PROFILE_ID
            self.make_symlink(
                outside_profile,
                profiles_root / PROFILE_ID,
                target_is_directory=True,
            )

            with self.assertRaisesRegex(
                ProfileStoreError,
                "Voice profile directory.*symbolic link",
            ):
                load_profile_from_store(profiles_root, PROFILE_ID)

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_profile_metadata_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)
            profile_dir = profiles_root / PROFILE_ID
            outside = Path(temporary_dir) / "outside.json"
            profile_dir.mkdir(parents=True)
            outside.write_text('{"transcript":"outside"}', encoding="utf-8")
            (profile_dir / "reference.wav").write_bytes(b"wave fixture")
            self.make_symlink(outside, profile_dir / "profile.json")

            with self.assertRaisesRegex(
                ProfileStoreError,
                "Voice profile metadata.*symbolic link",
            ):
                load_profile_from_store(profiles_root, PROFILE_ID)
            self.assertEqual(
                outside.read_text(encoding="utf-8"),
                '{"transcript":"outside"}',
            )

    @unittest.skipUnless(hasattr(os, "symlink"), "symbolic links are unavailable")
    def test_reference_audio_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profiles_root = self.make_root(temporary_dir)
            profile_dir = profiles_root / PROFILE_ID
            outside = Path(temporary_dir) / "outside.wav"
            profile_dir.mkdir(parents=True)
            (profile_dir / "profile.json").write_text(
                '{"id":"%s"}' % PROFILE_ID,
                encoding="utf-8",
            )
            outside.write_bytes(b"outside audio")
            self.make_symlink(outside, profile_dir / "reference.wav")

            with self.assertRaisesRegex(
                ProfileStoreError,
                "Voice profile reference audio.*symbolic link",
            ):
                load_profile_from_store(profiles_root, PROFILE_ID)
            self.assertEqual(outside.read_bytes(), b"outside audio")


if __name__ == "__main__":
    unittest.main()
