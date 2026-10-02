#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import '../js/formats/jpeg.js';
import '../js/formats/gif.js';
import '../js/formats/tiff.js';
import '../js/formats/bmp.js';
import '../js/formats/png.js';
import '../js/formats/pcx.js';
import '../js/parser.js';

import {
  buildBmpCore,
  buildBmpInfo,
  buildPng,
  buildGif,
  buildTiff,
  buildJpeg,
  buildPcx
} from '../tools/generate-test-images.mjs';

const ImgInfo = globalThis.ImgInfo;

if (!ImgInfo || typeof ImgInfo.parse !== 'function') {
  console.error('globalThis.ImgInfo не загружен: проверьте импорты js/*.js');
  process.exit(1);
}

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error('FAIL:', name, e && e.message !== undefined ? e.message : e);
  }
}

function assert(truthy, msg) {
  if (!truthy) throw new Error(msg || 'утверждение ложно');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'assertEq') + ': ожидалось ' + JSON.stringify(expected) +
      ', получено ' + JSON.stringify(actual));
  }
}

function assertApprox(actual, expected, eps, msg) {
  if (actual === null || actual === undefined || Math.abs(actual - expected) > eps) {
    throw new Error((msg || 'assertApprox') + ': |' + JSON.stringify(actual) +
      ' - ' + expected + '| > ' + eps);
  }
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(msg || 'ожидалось исключение');
}

function parseFull(bytes, ext, tailBytes) {
  return ImgInfo.parse(bytes, ext, bytes.length, tailBytes);
}

function findExtra(info, name) {
  const extra = info.extras.find((e) => e.name === name);
  if (!extra) {
    throw new Error('в extras нет «' + name + '» (есть: ' +
      info.extras.map((e) => e.name).join('; ') + ')');
  }
  return extra;
}

test('BMP CORE-заголовок: размеры, dpi null, BI_RGB', () => {
  const info = parseFull(buildBmpCore(), 'bmp');
  assertEq(info.format, 'BMP');
  assertEq(info.width, 16);
  assertEq(info.height, 8);
  assertEq(info.dpiX, null, 'dpiX в CORE-заголовке отсутствует');
  assertEq(info.dpiY, null, 'dpiY в CORE-заголовке отсутствует');
  assertEq(info.bitDepth, 24);
  assert(String(info.compression).includes('BI_RGB'), 'compression: ' + info.compression);
  assertEq(findExtra(info, 'Версия заголовка').value, 'BITMAPCOREHEADER (OS/2 и Windows 1.x)');
});

test('BMP INFO-заголовок: dpi 72 из 2835 ppm', () => {
  const info = parseFull(buildBmpInfo({ width: 10, height: 5, bpp: 24 }), 'bmp');
  assertEq(info.width, 10);
  assertEq(info.height, 5);
  assertApprox(info.dpiX, 72, 1);
  assertApprox(info.dpiY, 72, 1);
  assertEq(info.bitDepth, 24);
  assert(String(info.compression).includes('без сжатия'));
});

test('BMP BI_RLE8', () => {
  const info = parseFull(buildBmpInfo({ width: 16, height: 4, bpp: 8, compression: 1, clrUsed: 256 }), 'bmp');
  assertEq(info.bitDepth, 8);
  assert(String(info.compression).includes('BI_RLE8'), 'compression: ' + info.compression);
  assert(String(info.compression).includes('RLE'));
  assertEq(findExtra(info, 'Число цветов палитры').value, 256);
});

test('BMP отрицательная высота → height положительный', () => {
  const info = parseFull(buildBmpInfo({ width: 8, height: -200, bpp: 24 }), 'bmp');
  assertEq(info.width, 8);
  assertEq(info.height, 200);
});

test('PNG: 800×600, pHYs 2835 ppm → 72 dpi, палитра 256', () => {
  const info = parseFull(buildPng({ plteColors: 256 }), 'png');
  assertEq(info.format, 'PNG');
  assertEq(info.width, 800);
  assertEq(info.height, 600);
  assertApprox(info.dpiX, 72, 1);
  assertApprox(info.dpiY, 72, 1);
  assertEq(info.bitDepth, 32, '8 бит × 4 канала (RGBA)');
  assert(String(info.compression).includes('Deflate'), 'compression: ' + info.compression);
  assertEq(findExtra(info, 'Число цветов палитры').value, 256);
});

test('PNG: pHYs 11811 ppm → 300 dpi, интерлейс Adam7', () => {
  const info = parseFull(buildPng({ ppux: 11811, ppuy: 11811, interlace: 1 }), 'png');
  assertApprox(info.dpiX, 300, 1);
  assertApprox(info.dpiY, 300, 1);
  assertEq(findExtra(info, 'Интерлейс (чересстрочность)').value, 'Adam7');
});

test('GIF: GCT 256 цветов (gctSize 7)', () => {
  const info = parseFull(buildGif({ gctSize: 7 }), 'gif');
  assertEq(info.format, 'GIF');
  assertEq(info.width, 64);
  assertEq(info.height, 32);
  assertEq(info.dpiX, null);
  assertEq(info.dpiY, null);
  assertEq(info.bitDepth, 8);
  assert(String(info.compression).includes('LZW'), 'compression: ' + info.compression);
  assertEq(findExtra(info, 'Число цветов глобальной палитры').value, 256);
});

test('GIF без GCT: глубина из colorRes', () => {
  const info = parseFull(buildGif({ gct: false }), 'gif');
  assertEq(info.bitDepth, 8, 'colorRes 7 → 8 бит');
  assertEq(info.extras.find((e) => e.name === 'Число цветов глобальной палитры'), undefined);
});

test('GIF: 2 кадра (анимация) и прозрачный индекс', () => {
  const info = parseFull(buildGif({ frames: 2, transparentIndex: 42 }), 'gif');
  const frames = findExtra(info, 'Число кадров');
  assert(String(frames.value).startsWith('2 '), 'кадры: ' + frames.value);
  assert(String(frames.value).includes('анимация'));
  assertEq(findExtra(info, 'Прозрачный цвет').value, 'индекс 42');
});

test('GIF 87a: версия из сигнатуры', () => {
  const info = parseFull(buildGif({ version: '87a' }), 'gif');
  assert(String(findExtra(info, 'Версия GIF').value).includes('87a'));
});

test('TIFF LE: 320×240, 300 dpi, без сжатия, Software', () => {
  const info = parseFull(buildTiff(), 'tif');
  assertEq(info.format, 'TIFF');
  assertEq(info.width, 320);
  assertEq(info.height, 240);
  assertApprox(info.dpiX, 300, 1);
  assertApprox(info.dpiY, 300, 1);
  assertEq(info.bitDepth, 24, '8+8+8 бит');
  assert(String(info.compression).includes('без сжатия'));
  assertEq(findExtra(info, 'Порядок байт').value, 'little-endian (II)');
  assertEq(findExtra(info, 'Программа').value, 'Test');
});

test('TIFF big-endian (MM)', () => {
  const info = parseFull(buildTiff({ endian: 'MM' }), 'tif');
  assertEq(info.width, 320);
  assertEq(info.height, 240);
  assertApprox(info.dpiX, 300, 1);
  assertEq(findExtra(info, 'Порядок байт').value, 'big-endian (MM)');
});

test('TIFF Compression=5 → LZW', () => {
  const info = parseFull(buildTiff({ compression: 5 }), 'tif');
  assert(String(info.compression).includes('LZW'), 'compression: ' + info.compression);
});

test('TIFF Compression=32773 → PackBits', () => {
  const info = parseFull(buildTiff({ compression: 32773 }), 'tif');
  assert(String(info.compression).includes('PackBits'), 'compression: ' + info.compression);
});

test('TIFF ResolutionUnit=3 (см) → dpi ×2.54', () => {
  const info = parseFull(buildTiff({ resUnit: 3 }), 'tif');
  assertApprox(info.dpiX, 300 * 2.54, 1, '300 точек/см ≈ 762 dpi');
  assertApprox(info.dpiY, 300 * 2.54, 1);
});

test('JPEG baseline: 640×480, 72 dpi, 4:2:0', () => {
  const info = parseFull(buildJpeg(), 'jpg');
  assertEq(info.format, 'JPEG');
  assertEq(info.width, 640);
  assertEq(info.height, 480);
  assertEq(info.dpiX, 72);
  assertEq(info.dpiY, 72);
  assertEq(info.bitDepth, 24);
  assertEq(info.bitDepthText, '8 бит × 3 канала');
  assert(String(info.compression).includes('baseline'), 'compression: ' + info.compression);
  assertEq(findExtra(info, 'Субдискретизация цветоразностных каналов').value, '4:2:0');
});

test('JPEG units=3 (dpcm): 28 dpcm ≈ 72 dpi ± 1', () => {
  const info = parseFull(buildJpeg({ units: 3, xd: 28, yd: 28 }), 'jpg');
  assertApprox(info.dpiX, 72, 1);
  assertApprox(info.dpiY, 72, 1);
});

test('JPEG SOF2 → progressive', () => {
  const info = parseFull(buildJpeg({ sof: 0xC2 }), 'jpg');
  assert(String(info.compression).includes('progressive'), 'compression: ' + info.compression);
  assert(String(findExtra(info, 'Вариант кодирования').value).includes('SOF2'));
});

test('JPEG DQT: матрица после де-зигзага (билдер пишет 1..64 зигзагом)', () => {
  const info = parseFull(buildJpeg(), 'jpg');
  const dqt = findExtra(info, 'Таблица квантования #0 (8 бит)');
  const m = dqt.value;
  assertEq(m.length, 8);
  assertEq(m[0].length, 8);
  assertEq(m[0][0], 1, 'natural[0] ← zig[0]');
  assertEq(m[0][1], 2, 'natural[1] ← zig[1]');
  assertEq(m[1][0], 3, 'natural[8] ← zig[2]');
  assertEq(m[2][0], 4, 'natural[16] ← zig[3]');
  assertEq(m[1][1], 5, 'natural[9] ← zig[4]');
  assertEq(m[7][7], 64, 'natural[63] ← zig[63]');
});

test('JPEG APP1/Exif: Make/Model и dpi из Exif', () => {
  const info = parseFull(buildJpeg({ exif: true }), 'jpg');
  assertEq(info.dpiX, 72, 'XResolution 72 при unit=2');
  assertEq(info.dpiY, 72);
  assertEq(findExtra(info, 'Камера (Exif)').value, 'TestMake TestModel');
});

test('PCX 8-бит: размеры, 96 dpi, RLE, VGA-палитра 256 в tailBytes', () => {
  const bytes = buildPcx();
  const info = parseFull(bytes, 'pcx', bytes.slice(-1024));
  assertEq(info.format, 'PCX');
  assertEq(info.width, 320);
  assertEq(info.height, 200);
  assertEq(info.dpiX, 96);
  assertEq(info.dpiY, 96);
  assertEq(info.bitDepth, 8);
  assert(String(info.compression).includes('RLE'), 'compression: ' + info.compression);
  const vga = findExtra(info, 'Число цветов палитры');
  assert(String(vga.value).includes('256'), 'палитра: ' + vga.value);
});

test('PCX 24-бит (3 плоскости × 8 бит), без VGA-палитры', () => {
  const bytes = buildPcx({ version: 3, nPlanes: 3, vgaPalette: false });
  const info = parseFull(bytes, 'pcx', bytes.slice(-1024));
  assertEq(info.width, 320);
  assertEq(info.height, 200);
  assertEq(info.bitDepth, 24);
  assertEq(info.extras.find((e) => e.name === 'Число цветов палитры'), undefined);
});

const EXT_TO_KEY = { bmp: 'bmp', png: 'png', gif: 'gif', tif: 'tiff', jpg: 'jpeg', pcx: 'pcx' };
const imagesDir = join(dirname(fileURLToPath(import.meta.url)), 'images');
const imageFiles = readdirSync(imagesDir).filter((f) => /^\./.test(f) === false);

for (const file of imageFiles) {
  test('файл ' + file + ': sniff + parse', () => {
    const bytes = new Uint8Array(readFileSync(join(imagesDir, file)));
    const ext = file.substring(file.lastIndexOf('.') + 1).toLowerCase();
    const key = ImgInfo.sniff(bytes);
    assertEq(key, EXT_TO_KEY[ext], 'sniff по сигнатуре');
    const info = ImgInfo.parse(bytes, ext, bytes.length, ext === 'pcx' ? bytes.slice(-1024) : undefined);
    assertEq(typeof info.width, 'number', 'width — число');
    assert(info.width > 0, 'width > 0');
    assert(info.height > 0, 'height > 0');
  });
}

test('needMoreBytes: JPEG, буфер обрезан до SOF', () => {
  const bytes = buildJpeg();
  let sofOff = -1;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0xFF && (bytes[i + 1] === 0xC0 || bytes[i + 1] === 0xC2)) { sofOff = i; break; }
  }
  assert(sofOff > 0, 'маркер SOF не найден в билдере');
  const truncated = bytes.slice(0, Math.min(200, sofOff));
  const info = ImgInfo.parse(truncated, 'jpg', truncated.length);
  assertEq(info.needMoreBytes, true);
});

test('needMoreBytes: TIFF со смещением IFD за пределами буфера', () => {
  const bytes = Uint8Array.from([0x49, 0x49, 42, 0, 0x40, 0x42, 0x0F, 0x00]);
  const info = ImgInfo.parse(bytes, 'tif', 1000002);
  assertEq(info.needMoreBytes, true);
});

const garbage = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xFF);
for (const ext of ['jpg', 'jpeg', 'gif', 'tif', 'tiff', 'bmp', 'png', 'pcx']) {
  test('мусорные байты с расширением ' + ext + ' → throw', () => {
    assertThrows(() => ImgInfo.parse(garbage.slice(), ext, garbage.length));
  });
}

test('приоритет сигнатуры: png-байты с расширением jpg', () => {
  const bytes = buildPng();
  assertEq(ImgInfo.sniff(bytes), 'png');
  const info = ImgInfo.parse(bytes, 'jpg', bytes.length);
  assertEq(info.format, 'PNG');
});

test('sniff: магики всех форматов', () => {
  assertEq(ImgInfo.sniff(buildJpeg().slice(0, 2)), 'jpeg', 'FF D8');
  assertEq(ImgInfo.sniff(buildGif().slice(0, 4)), 'gif', 'GIF8');
  assertEq(ImgInfo.sniff(buildTiff().slice(0, 4)), 'tiff', 'II*\\0');
  assertEq(ImgInfo.sniff(buildTiff({ endian: 'MM' }).slice(0, 4)), 'tiff', 'MM\\0*');
  assertEq(ImgInfo.sniff(buildBmpInfo().slice(0, 2)), 'bmp', 'BM');
  assertEq(ImgInfo.sniff(buildPng().slice(0, 4)), 'png', '\\x89PNG');
  assertEq(ImgInfo.sniff(buildPng().slice(0, 8)), 'png', 'полная сигнатура');
  assertEq(ImgInfo.sniff(buildPcx()), 'pcx', 'полный заголовок 128 байт');
  assertEq(ImgInfo.sniff(buildPcx().slice(0, 128)), 'pcx', 'ровно 128 байт заголовка');
  assertEq(ImgInfo.sniff(garbage), null, 'мусор → null');
});

test('sniff: пустой и короткий буфер не падают', () => {
  assertEq(ImgInfo.sniff(new Uint8Array(0)), null);
  assertEq(ImgInfo.sniff(new Uint8Array(1)), null);
  assertEq(ImgInfo.sniff(new Uint8Array([0x00, 0x01])), null);
});

console.log('PASS', pass, 'FAIL', fail);
process.exit(fail ? 1 : 0);
