#!/usr/bin/env node
/**
 * Downloads the on-device AI models Kinora bundles into resources/models/ (git-ignored), and
 * copies the WebAssembly runtimes they need from node_modules. Safe to run repeatedly: files that
 * already exist with the expected size are skipped.
 *
 *   npm run models
 *
 * Sources (all permissively licensed):
 *   - Whisper base (timestamped, int8 ONNX) — huggingface.co/onnx-community, Apache-2.0
 *   - MediaPipe selfie segmenter, face detector, object detector — storage.googleapis.com, Apache-2.0
 */
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'resources', 'models');

const HF = 'https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/main';
const WHISPER_DIR = 'onnx-community/whisper-base_timestamped';
const MP = 'https://storage.googleapis.com/mediapipe-models';

const downloads = [
  ...['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'normalizer.json'].map((f) => ({
    url: `${HF}/${f}`,
    file: `${WHISPER_DIR}/${f}`,
  })),
  { url: `${HF}/onnx/encoder_model_quantized.onnx`, file: `${WHISPER_DIR}/onnx/encoder_model_quantized.onnx` },
  { url: `${HF}/onnx/decoder_model_merged_quantized.onnx`, file: `${WHISPER_DIR}/onnx/decoder_model_merged_quantized.onnx` },
  { url: `${MP}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`, file: 'mediapipe/selfie_segmenter.tflite' },
  { url: `${MP}/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite`, file: 'mediapipe/blaze_face_short_range.tflite' },
  { url: `${MP}/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite`, file: 'mediapipe/efficientdet_lite0.tflite' },
];

async function exists(file) {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function download({ url, file }) {
  const dest = path.join(out, file);
  if (await exists(dest)) {
    console.log(`  ✓ ${file} (cached)`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, dest);
  console.log(`  ↓ ${file} (${((await stat(dest)).size / 1e6).toFixed(1)} MB)`);
}

async function copyDir(from, to, filter) {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    if (!filter(name)) continue;
    await copyFile(path.join(from, name), path.join(to, name));
  }
}

console.log(`Fetching models into ${path.relative(root, out)}/`);
for (const d of downloads) await download(d);

// WebAssembly runtimes, served from the same folder so the app never reaches the network.
await copyDir(path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), path.join(out, 'mediapipe/wasm'), () => true);
await copyDir(path.join(root, 'node_modules/onnxruntime-web/dist'), path.join(out, 'ort'), (n) => /^ort-wasm.*\.(wasm|mjs)$/.test(n));
console.log('  ✓ runtimes copied (mediapipe/wasm, ort)');
console.log('Done.');
