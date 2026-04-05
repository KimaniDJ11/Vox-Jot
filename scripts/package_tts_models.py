import os
import subprocess
import shutil

# Make sure huggingface_hub is installed:
# pip install huggingface_hub

try:
    from huggingface_hub import snapshot_download
except ImportError:
    print("Please install huggingface_hub first: pip install huggingface_hub")
    exit(1)

MODELS = [
    # (HuggingFace Repo ID, Local Folder Name, Output Tar Name)
    ("Qwen/Qwen3-TTS-12Hz-0.6B-Base", "qwen3-0.6b-base", "qwen3-0.6b-base.tar.gz"),
    ("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "qwen3-0.6b-customvoice", "qwen3-0.6b-customvoice.tar.gz"),
    ("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "qwen3-1.7b-customvoice", "qwen3-1.7b-customvoice.tar.gz"),
    ("fishaudio/fish-speech-1.5", "fish-speech", "tts-fish-speech-1.5.tar.gz")
]

GH_RELEASE = "v0.3.0-tts-models"

# Ensure the release exists first
print(f"Ensuring GitHub release {GH_RELEASE} exists...")
env = os.environ.copy()
if "GITHUB_TOKEN" in env:
    del env["GITHUB_TOKEN"]  # Use gh CLI keyring auth instead of invalid env token

subprocess.run([
    "gh", "release", "create", GH_RELEASE, 
    "-t", "TTS Models (v0.3.0)", 
    "-n", "Offline model packages for Text-to-Speech."
], env=env, stderr=subprocess.DEVNULL)

for repo_id, folder, tar_name in MODELS:
    print(f"\n--- Processing {repo_id} ---")
    print(f"Downloading weights to {folder}...")
    try:
        snapshot_download(repo_id=repo_id, local_dir=folder, local_dir_use_symlinks=False)
    except Exception as e:
        print(f"Failed to download {repo_id}: {e}")
        continue
    
    print(f"Compressing {folder} into {tar_name}...")
    try:
        subprocess.run(["tar", "-czf", tar_name, folder], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Compression failed for {folder}: {e}")
        continue
    
    print(f"Uploading {tar_name} to GitHub release {GH_RELEASE}...")
    try:
        subprocess.run(["gh", "release", "upload", GH_RELEASE, tar_name, "--clobber"], env=env, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Upload failed for {tar_name}: {e}")
        continue
    
    print(f"Cleaning up local files for {folder}...")
    shutil.rmtree(folder, ignore_errors=True)
    if os.path.exists(tar_name):
        os.remove(tar_name)

print("\n--- All models packaged and uploaded successfully! ---")
