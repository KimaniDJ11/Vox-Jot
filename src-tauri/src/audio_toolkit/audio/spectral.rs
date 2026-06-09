//! Spectral noise reduction (spectral subtraction) — a classic DSP denoiser that
//! complements the learned RNNoise model. It estimates a per-frequency noise
//! floor from the whole signal (minimum statistics), then attenuates each STFT
//! bin by an oversubtraction gain with a residual floor to limit musical noise.
//!
//! Unlike RNNoise (voice-tuned, fixed behavior) this is whole-file, works at any
//! sample rate, and exposes an adjustable `strength`, which makes it a good
//! second engine for steady broadband noise (hiss, fans, line hum). Because it
//! needs the entire signal to estimate the noise floor, it is offline-only (the
//! live capture path uses RNNoise).

use rustfft::{num_complex::Complex, FftPlanner};

const FRAME_SIZE: usize = 1024;
// 75% overlap so a Hann analysis+synthesis window satisfies the COLA constraint.
const HOP_SIZE: usize = FRAME_SIZE / 4;

fn hann_window() -> [f32; FRAME_SIZE] {
    let mut window = [0.0f32; FRAME_SIZE];
    for (n, value) in window.iter_mut().enumerate() {
        *value = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * n as f32 / FRAME_SIZE as f32).cos();
    }
    window
}

// 3-tap moving average across frequency to stabilize the per-bin noise estimate.
fn smooth_across_frequency(noise: &[f32]) -> Vec<f32> {
    let len = noise.len();
    let mut out = vec![0.0f32; len];
    for k in 0..len {
        let lo = k.saturating_sub(1);
        let hi = (k + 1).min(len - 1);
        out[k] = (noise[lo] + noise[k] + noise[hi]) / 3.0;
    }
    out
}

/// Denoise mono `samples` via spectral subtraction. `strength` in `[0, 1]`:
/// higher removes more noise but risks artifacts. Returns audio at the same
/// sample rate and length as the input.
pub fn spectral_denoise(samples: &[f32], strength: f32) -> Vec<f32> {
    if samples.len() < FRAME_SIZE {
        return samples.to_vec();
    }
    let strength = strength.clamp(0.0, 1.0);
    let window = hann_window();
    let num_bins = FRAME_SIZE / 2 + 1;

    // Pad the tail so the final hop still has a full analysis frame; trim later.
    let original_len = samples.len();
    let mut signal = samples.to_vec();
    signal.resize(original_len + FRAME_SIZE, 0.0);

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FRAME_SIZE);
    let ifft = planner.plan_fft_inverse(FRAME_SIZE);
    let mut scratch = vec![Complex::new(0.0f32, 0.0f32); FRAME_SIZE];

    // ── Pass 1: estimate the per-bin noise magnitude (minimum statistics). ──
    let mut noise = vec![f32::INFINITY; num_bins];
    let mut start = 0usize;
    while start + FRAME_SIZE <= signal.len() {
        for (i, slot) in scratch.iter_mut().enumerate() {
            *slot = Complex::new(signal[start + i] * window[i], 0.0);
        }
        fft.process(&mut scratch);
        for (k, floor) in noise.iter_mut().enumerate() {
            let mag = scratch[k].norm();
            if mag < *floor {
                *floor = mag;
            }
        }
        start += HOP_SIZE;
    }
    for floor in noise.iter_mut() {
        if !floor.is_finite() {
            *floor = 0.0;
        }
    }
    let noise = smooth_across_frequency(&noise);

    // ── Pass 2: subtract the noise floor and reconstruct via overlap-add. ──
    let alpha = 1.0 + 2.0 * strength; // oversubtraction factor, 1..3
    let floor_gain = 0.02 + 0.18 * (1.0 - strength); // residual gain, 0.2..0.02
    let inv_n = 1.0 / FRAME_SIZE as f32;

    let mut out = vec![0.0f32; signal.len()];
    let mut norm = vec![0.0f32; signal.len()];

    start = 0;
    while start + FRAME_SIZE <= signal.len() {
        for (i, slot) in scratch.iter_mut().enumerate() {
            *slot = Complex::new(signal[start + i] * window[i], 0.0);
        }
        fft.process(&mut scratch);

        for (k, bin) in scratch.iter_mut().enumerate() {
            // Bins k and FRAME_SIZE-k are conjugates; map the upper half back
            // onto the [0, num_bins) noise estimate.
            let noise_index = if k < num_bins { k } else { FRAME_SIZE - k };
            let mag = bin.norm();
            let subtracted = mag - alpha * noise[noise_index];
            let gain = if mag > 1e-9 {
                (subtracted / mag).max(floor_gain)
            } else {
                floor_gain
            };
            *bin *= gain;
        }

        ifft.process(&mut scratch);

        for (i, slot) in scratch.iter().enumerate() {
            out[start + i] += slot.re * inv_n * window[i];
            norm[start + i] += window[i] * window[i];
        }
        start += HOP_SIZE;
    }

    out.truncate(original_len);
    for (sample, weight) in out.iter_mut().zip(norm.iter()) {
        if *weight > 1e-6 {
            *sample /= *weight;
        }
        *sample = sample.clamp(-1.0, 1.0);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_short_signals() {
        let input = vec![0.1, -0.2, 0.3];
        assert_eq!(spectral_denoise(&input, 0.8), input);
    }

    #[test]
    fn preserves_length_and_finiteness() {
        let input: Vec<f32> = (0..(FRAME_SIZE * 8))
            .map(|i| {
                let theta = i as f32 * 2.0 * std::f32::consts::PI * 440.0 / 48_000.0;
                theta.sin() * 0.3
            })
            .collect();
        let output = spectral_denoise(&input, 0.8);
        assert_eq!(output.len(), input.len());
        assert!(output.iter().all(|s| s.is_finite()));
        assert!(output.iter().all(|s| (-1.0..=1.0).contains(s)));
    }

    #[test]
    fn attenuates_steady_broadband_noise() {
        // A pure tone plus low-level white-ish noise; spectral subtraction should
        // reduce the between-harmonics noise floor, lowering total energy.
        let mut seed = 12345u32;
        let mut rng = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
        };
        let input: Vec<f32> = (0..(FRAME_SIZE * 16))
            .map(|i| {
                let theta = i as f32 * 2.0 * std::f32::consts::PI * 300.0 / 48_000.0;
                theta.sin() * 0.4 + rng() * 0.08
            })
            .collect();
        let output = spectral_denoise(&input, 0.9);
        let energy = |s: &[f32]| s.iter().map(|v| v * v).sum::<f32>();
        // Interior frames (away from the ramped edges) should not gain energy.
        let lo = FRAME_SIZE * 2;
        let hi = input.len() - FRAME_SIZE * 2;
        assert!(energy(&output[lo..hi]) <= energy(&input[lo..hi]));
    }
}
