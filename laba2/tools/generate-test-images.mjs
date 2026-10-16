#!/usr/bin/env node
// Генератор тестовых изображений для парсеров заголовков (JPEG/GIF/TIFF/BMP/PNG/PCX).
//
// Режимы:
//   node tools/generate-test-images.mjs              — 20 маленьких тестовых файлов → tests/images/
//   node tools/generate-test-images.mjs --big [МиБ]  — демо-папка для демонстрации быстродействия
//                                                     (по умолчанию 2048 МиБ ≈ 2 ГиБ) → demo-folder/

import { closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function u8(v) {
  return v & 0xFF;
}

function u16le(v) {
  return [u8(v), u8(v >>> 8)];
}

function u16be(v) {
  return [u8(v >>> 8), u8(v)];
}

function u32le(v) {
  return [u8(v), u8(v >>> 8), u8(v >>> 16), u8(v >>> 24)];
}

function u32be(v) {
  return [u8(v >>> 24), u8(v >>> 16), u8(v >>> 8), u8(v)];
}

function ascii(str) {
  return Array.from(str, (ch) => ch.charCodeAt(0));
}

function zeros(n) {
  return new Array(n).fill(0);
}

function pack(parts) {
  return Uint8Array.from(parts.flat(Infinity));
}

export function buildBmpCore({ width = 16, height = 8, bpp = 24 } = {}) {
  const rowSize = Math.ceil((width * bpp) / 32) * 4;
  const pixelSize = rowSize * height;
  const offBits = 14 + 12;
  return pack([
    [0x42, 0x4D],
    u32le(offBits + pixelSize),
    [0, 0, 0, 0],
    u32le(offBits),
    u32le(12),
    u16le(width), u16le(height), u16le(1), u16le(bpp),
    zeros(pixelSize)
  ]);
}

export function buildBmpInfo({ width = 10, height = 5, bpp = 24, compression = 0,
                               xppm = 2835, yppm = 2835, clrUsed = 0 } = {}) {
  const paletteColors = clrUsed !== 0 ? clrUsed : (bpp <= 8 ? 1 << bpp : 0);
  const offBits = 14 + 40 + paletteColors * 4;
  const rowSize = Math.ceil((width * bpp) / 32) * 4;
  const imageSize = compression === 0 ? rowSize * Math.abs(height) : 64;
  return pack([
    [0x42, 0x4D],
    u32le(offBits + imageSize),
    [0, 0, 0, 0],
    u32le(offBits),
    u32le(40),
    u32le(width),
    u32le(height),
    u16le(1),
    u16le(bpp),
    u32le(compression),
    u32le(imageSize),
    u32le(xppm),
    u32le(yppm),
    u32le(clrUsed),
    u32le(0),
    zeros(paletteColors * 4),
    zeros(imageSize)
  ]);
}

function pngChunk(type, data) {
  const flat = data.flat(Infinity);
  return [u32be(flat.length), ascii(type), flat, [0, 0, 0, 0]];
}

export function buildPng({ width = 800, height = 600, bitDepth = 8, colorType = 6,
                           interlace = 0, ppux = 2835, ppuy = 2835, unit = 1,
                           plteColors = 0 } = {}) {
  const bytes = [
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    pngChunk('IHDR', [u32be(width), u32be(height), bitDepth, colorType, 0, 0, interlace])
  ];
  if (ppux !== null) {
    bytes.push(pngChunk('pHYs', [u32be(ppux), u32be(ppuy), unit]));
  }
  if (plteColors > 0) {
    bytes.push(pngChunk('PLTE', zeros(plteColors * 3)));
  }
  bytes.push(pngChunk('IDAT', []));
  bytes.push(pngChunk('IEND', []));
  return pack(bytes);
}

export function buildGif({ version = '89a', width = 64, height = 32, gct = true,
                           gctSize = 0, colorRes = 7, frames = 1,
                           transparentIndex = null } = {}) {
  const packed = (gct ? 0x80 : 0) | ((colorRes & 0x07) << 4) | (gct ? (gctSize & 0x07) : 0);
  const bytes = [
    ascii('GIF' + version),
    u16le(width), u16le(height), packed, 0, 0,
    ...(gct ? [zeros(3 * (1 << (gctSize + 1)))] : [])
  ];
  for (let f = 0; f < frames; f++) {
    if (version === '89a' && transparentIndex !== null) {
      bytes.push([0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, transparentIndex, 0x00]);
    }
    bytes.push([
      0x2C,
      u16le(0), u16le(0), u16le(width), u16le(height), 0x00,
      8,
      0x0A, zeros(10), 0x00
    ]);
  }
  bytes.push([0x3B]);
  return pack(bytes);
}

export function buildTiff({ endian = 'II', width = 320, height = 240, bits = [8, 8, 8],
                            compression = 1, photometric = 2, samples = 3,
                            xres = 300, yres = 300, resUnit = 2, software = 'Test' } = {}) {
  const le = endian === 'II';
  const u16 = (v) => (le ? u16le(v) : u16be(v));
  const u32 = (v) => (le ? u32le(v) : u32be(v));
  const shortInline = (v) => [...u16(v), 0, 0];

  const entries = [
    [256, 4, 1, u32(width)],
    [257, 4, 1, u32(height)],
    [258, 3, bits.length, 'bits'],
    [259, 3, 1, shortInline(compression)],
    [262, 3, 1, shortInline(photometric)],
    [273, 4, 1, 'strip'],
    [277, 3, 1, shortInline(samples)],
    [282, 5, 1, 'xres'],
    [283, 5, 1, 'yres'],
    [296, 3, 1, shortInline(resUnit)],
    [305, 2, software.length + 1, 'software']
  ];

  const ifdOff = 8;
  let off = ifdOff + 2 + entries.length * 12 + 4;
  const link = { bits: null, strip: null, xres: null, yres: null, software: null };
  for (const entry of entries) {
    const key = entry[3];
    if (typeof key === 'string') {
      link[key] = off;
      if (key === 'bits') off += bits.length * 2;
      else if (key === 'xres' || key === 'yres') off += 8;
      else if (key === 'software') off += software.length + 1;
      else if (key === 'strip') off += 16;
    }
  }
  const bytes = [
    ascii(endian), u16(42), u32(ifdOff),
    u16(entries.length),
    entries.map(([tag, type, count, val]) =>
      typeof val === 'string'
        ? [...u16(tag), ...u16(type), ...u32(count), ...u32(link[val])]
        : [...u16(tag), ...u16(type), ...u32(count), ...val]),
    u32(0),
    bits.flatMap((b) => u16(b)),
    zeros(16),
    u32(xres), u32(1),
    u32(yres), u32(1),
    [...ascii(software), 0]
  ];
  return pack(bytes);
}

function jpegSegment(marker, payload) {
  const flat = payload.flat(Infinity);
  return [0xFF, marker, u16be(flat.length + 2), flat];
}

function buildExif({ xres = 72, yres = 72, unit = 2, make = 'TestMake', model = 'TestModel' } = {}) {
  const u16 = u16le, u32 = u32le;
  const ifdRel = 8;
  const xresRel = ifdRel + 2 + 5 * 12 + 4;
  const yresRel = xresRel + 8;
  const makeRel = yresRel + 8;
  const modelRel = makeRel + make.length + 1;
  const tiff = [
    [0x49, 0x49], u16(42), u32(ifdRel),
    u16(5),
    [u16(0x010F), u16(2), u32(make.length + 1), u32(makeRel)],
    [u16(0x0110), u16(2), u32(model.length + 1), u32(modelRel)],
    [u16(0x011A), u16(5), u32(1), u32(xresRel)],
    [u16(0x011B), u16(5), u32(1), u32(yresRel)],
    [u16(0x0128), u16(3), u32(1), [...u16(unit), 0, 0]],
    u32(0),
    u32(xres), u32(1),
    u32(yres), u32(1),
    [...ascii(make), 0],
    [...ascii(model), 0]
  ];
  return [...ascii('Exif'), 0, 0, tiff];
}

export function buildJpeg({ width = 640, height = 480, sof = 0xC0, units = 2,
                            xd = 72, yd = 72, exif = false } = {}) {
  const bytes = [[0xFF, 0xD8]];
  if (exif) {
    bytes.push(jpegSegment(0xE1, buildExif()));
  } else {
    bytes.push(jpegSegment(0xE0, [
      ...ascii('JFIF'), 0,
      1, 1,
      units,
      ...u16be(xd), ...u16be(yd),
      0, 0
    ]));
  }
  const dqt = [0x00];
  for (let i = 1; i <= 64; i++) dqt.push(i);
  bytes.push(jpegSegment(0xDB, dqt));
  bytes.push(jpegSegment(sof, [
    8,
    ...u16be(height), ...u16be(width),
    3,
    1, 0x22, 0,
    2, 0x11, 0,
    3, 0x11, 0
  ]));
  bytes.push([0xFF, 0xD9]);
  return pack(bytes);
}

export function buildPcx({ version = 5, encoding = 1, bpp = 8, nPlanes = 1,
                           xmin = 0, ymin = 0, xmax = 319, ymax = 199,
                           hdpi = 96, vdpi = 96, paletteType = 1,
                           vgaPalette = true, dataSize = 64 } = {}) {
  const width = xmax - xmin + 1;
  const bytesPerLine = Math.ceil((width * bpp) / 8);
  const bytes = [
    0x0A,
    version,
    encoding,
    bpp,
    u16le(xmin), u16le(ymin), u16le(xmax), u16le(ymax),
    u16le(hdpi), u16le(vdpi),
    zeros(48),
    0,
    nPlanes,
    u16le(bytesPerLine),
    u16le(paletteType),
    u16le(0), u16le(0),
    zeros(54),
    zeros(dataSize)
  ];
  if (vgaPalette) {
    bytes.push([0x0C], zeros(768));
  }
  return pack(bytes);
}

const FILES = [
  ['bmp-core.bmp', buildBmpCore()],
  ['bmp-info-24.bmp', buildBmpInfo({ width: 10, height: 5, bpp: 24 })],
  ['bmp-negative-height.bmp', buildBmpInfo({ width: 8, height: -200, bpp: 24 })],
  ['bmp-rle8.bmp', buildBmpInfo({ width: 16, height: 4, bpp: 8, compression: 1, clrUsed: 256 })],
  ['png-72dpi.png', buildPng({ plteColors: 256 })],
  ['png-300dpi-adam7.png', buildPng({ ppux: 11811, ppuy: 11811, interlace: 1 })],
  ['gif89a-anim.gif', buildGif({ frames: 2, transparentIndex: 42 })],
  ['gif89a-nogct.gif', buildGif({ gct: false })],
  ['gif87a.gif', buildGif({ version: '87a' })],
  ['tiff-le.tif', buildTiff()],
  ['tiff-be.tif', buildTiff({ endian: 'MM' })],
  ['tiff-lzw.tif', buildTiff({ compression: 5 })],
  ['tiff-packbits.tif', buildTiff({ compression: 32773 })],
  ['tiff-cm.tif', buildTiff({ resUnit: 3 })],
  ['jpeg-baseline-72.jpg', buildJpeg()],
  ['jpeg-dpcm.jpg', buildJpeg({ units: 3, xd: 28, yd: 28 })],
  ['jpeg-progressive.jpg', buildJpeg({ sof: 0xC2 })],
  ['jpeg-exif.jpg', buildJpeg({ exif: true })],
  ['pcx-8bit.pcx', buildPcx()],
  ['pcx-24bit.pcx', buildPcx({ version: 3, nPlanes: 3, vgaPalette: false })]
];

// ---------------------------------------------------------------------------
// Режим --big: папка большого объёма для демонстрации быстродействия.
// Заголовки строятся обычными билдерами, тело файла (сотни килобайт — мегабайты)
// дописывается нулевыми кусками поверх файлового дескриптора — без zeros()/pack(),
// поэтому память не зависит от размера файла. ПКХ-файлы с VGA-палитрой получают
// хвост 0x0C + 768 нулей последними 769 байтами файла.
// ---------------------------------------------------------------------------

const MIB = 1024 * 1024;
const BIG_DEFAULT_MIB = 2048;
const BIG_REF_MIB = 2048; // объём, на который рассчитаны доли форматов
const BIG_MIN_FILE_BYTES = 16 * 1024;
const PAD_CHUNK = Buffer.alloc(MIB);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 100 ? value.toFixed(1) : value.toFixed(2);
  return text.replace('.', ',') + ' ' + units[unit];
}

function pluralFiles(n) {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return n + ' файл';
  if (d10 >= 2 && d10 <= 4 && (d100 < 10 || d100 >= 20)) return n + ' файла';
  return n + ' файлов';
}

function writePadded(filePath, headerBytes, totalBytes, tailBytes) {
  const header = Buffer.isBuffer(headerBytes) ? headerBytes : Buffer.from(headerBytes);
  const tail = tailBytes
    ? (Buffer.isBuffer(tailBytes) ? tailBytes : Buffer.from(tailBytes))
    : null;
  const tailLen = tail ? tail.length : 0;
  const body = Math.max(0, totalBytes - header.length - tailLen);
  const fd = openSync(filePath, 'w');
  try {
    writeSync(fd, header);
    let left = body;
    while (left > 0) {
      const n = Math.min(left, PAD_CHUNK.length);
      writeSync(fd, PAD_CHUNK, 0, n);
      left -= n;
    }
    if (tail) writeSync(fd, tail);
  } finally {
    closeSync(fd);
  }
  return header.length + body + tailLen;
}

// BMP на много мегабайт нельзя строить через buildBmpInfo с большим height
// (imageSize прошёл бы через zeros()), поэтому заголовок строится с height = 1,
// а затем в буфере исправляются bfSize, biHeight и biSizeImage.
function buildBigBmpHeader(width, height, xppm, yppm) {
  const header = Buffer.from(buildBmpInfo({ width, height: 1, bpp: 24, xppm, yppm }));
  const offBits = header.readUInt32LE(10);
  const rowSize = Math.ceil((width * 24) / 32) * 4;
  const pixelBytes = rowSize * height;
  header.writeUInt32LE(offBits + pixelBytes, 2);
  header.writeUInt32LE(height, 22);
  header.writeUInt32LE(pixelBytes, 34);
  return { header, totalBytes: offBits + pixelBytes };
}

function pcxVgaTail() {
  const tail = new Uint8Array(769);
  tail[0] = 0x0C;
  return tail;
}

function planBmpJobs(count, perFile, jitter) {
  const widths = [1920, 2560, 3840];
  const ppms = [2835, 4724, 11811];
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const width = widths[i % widths.length];
    const ppm = ppms[i % ppms.length];
    const target = Math.round(perFile * jitter());
    const rowSize = Math.ceil((width * 24) / 32) * 4;
    const height = Math.max(1, Math.floor((target - 54) / rowSize));
    const built = buildBigBmpHeader(width, height, ppm, ppm);
    jobs.push({
      format: 'BMP', ext: 'bmp', prefix: 'render', bytes: built.totalBytes,
      write: (path) => writePadded(path, built.header, built.totalBytes)
    });
  }
  return jobs;
}

function planPngJobs(count, perFile, jitter) {
  const dims = [[1920, 1080], [2560, 1440], [3840, 2160], [1600, 1200]];
  const ppm = [[2835, 2835], [11811, 11811], [5906, 5906]];
  const indexedDims = [[320, 240], [256, 192]];
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const target = Math.round(perFile * jitter());
    const p = ppm[i % ppm.length];
    const d = dims[i % dims.length];
    const ind = indexedDims[(i / 5 | 0) % indexedDims.length];
    const opts = i % 5 === 4
      ? { width: ind[0], height: ind[1], colorType: 3, bitDepth: 8,
          plteColors: 256, ppux: p[0], ppuy: p[1] }
      : { width: d[0], height: d[1], interlace: i % 3 === 1 ? 1 : 0, ppux: p[0], ppuy: p[1] };
    jobs.push({
      format: 'PNG', ext: 'png', prefix: 'shot', bytes: target,
      write: (path) => writePadded(path, buildPng(opts), target)
    });
  }
  return jobs;
}

function planTiffJobs(count, perFile, jitter) {
  const dims = [[3200, 2400], [4000, 3000], [2400, 1600], [1024, 768]];
  const compressions = [1, 5, 32773];
  const resolutions = [300, 150, 600];
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const target = Math.round(perFile * jitter());
    const d = dims[i % dims.length];
    const res = resolutions[i % resolutions.length];
    const opts = {
      endian: i % 2 ? 'MM' : 'II',
      width: d[0], height: d[1],
      compression: compressions[i % compressions.length],
      resUnit: i % 4 === 3 ? 3 : 2,
      xres: res, yres: res
    };
    jobs.push({
      format: 'TIFF', ext: 'tif', prefix: 'scan', bytes: target,
      write: (path) => writePadded(path, buildTiff(opts), target)
    });
  }
  return jobs;
}

function planGifJobs(count, perFile, jitter) {
  const dims = [[800, 600], [640, 480], [1024, 768], [320, 240]];
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const target = Math.round(perFile * jitter());
    const d = dims[i % dims.length];
    const animated = i % 2 === 0;
    const opts = {
      version: '89a',
      width: d[0], height: d[1],
      gct: true, gctSize: 7,
      frames: animated ? 2 + ((i >> 1) % 3) : 1,
      transparentIndex: animated ? (i * 37) % 256 : null
    };
    jobs.push({
      format: 'GIF', ext: 'gif', prefix: 'anim', bytes: target,
      write: (path) => writePadded(path, buildGif(opts), target)
    });
  }
  return jobs;
}

function planPcxJobs(count, perFile, jitter) {
  const dims = [[640, 480], [800, 600], [1024, 768]];
  const dpis = [96, 150, 300];
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const target = Math.round(perFile * jitter());
    const d = dims[i % dims.length];
    const dpi = dpis[i % dpis.length];
    const is8Bit = i % 2 === 0;
    const opts = {
      version: is8Bit ? 5 : 3,
      bpp: 8,
      nPlanes: is8Bit ? 1 : 3,
      xmin: 0, ymin: 0, xmax: d[0] - 1, ymax: d[1] - 1,
      hdpi: dpi, vdpi: dpi,
      vgaPalette: false,
      dataSize: 64
    };
    const tail = is8Bit ? pcxVgaTail() : null;
    jobs.push({
      format: 'PCX', ext: 'pcx', prefix: 'art', bytes: target,
      write: (path) => writePadded(path, buildPcx(opts), target, tail)
    });
  }
  return jobs;
}

function planJpegJobs(budgetBytes, perFile, jitter) {
  const dims = [[5472, 3648], [4000, 3000], [6000, 4000], [3840, 2160], [4920, 3264]];
  const dpiVariants = [
    { units: 2, xd: 72, yd: 72 },
    { units: 2, xd: 300, yd: 300 },
    { units: 3, xd: 28, yd: 28 }
  ];
  const jobs = [];
  let left = budgetBytes;
  let j = 0;
  while (left >= 64 * 1024) {
    let size = Math.round(perFile * jitter());
    if (size < 64 * 1024) size = 64 * 1024;
    if (size >= left || left - size < 64 * 1024) size = left;
    const d = dims[j % dims.length];
    const v = dpiVariants[j % dpiVariants.length];
    const opts = {
      width: d[0], height: d[1],
      sof: j % 5 === 2 ? 0xC2 : 0xC0,
      exif: j % 7 === 3,
      units: v.units, xd: v.xd, yd: v.yd
    };
    jobs.push({
      format: 'JPEG', ext: 'jpg', prefix: 'photo', bytes: size,
      write: (path) => writePadded(path, buildJpeg(opts), size)
    });
    left -= size;
    j++;
  }
  return jobs;
}

const BIG_FIXED_SPECS = [
  { format: 'BMP', count: 30, mib: 5, plan: planBmpJobs },
  { format: 'PNG', count: 30, mib: 2, plan: planPngJobs },
  { format: 'TIFF', count: 20, mib: 1.5, plan: planTiffJobs },
  { format: 'GIF', count: 10, mib: 0.75, plan: planGifJobs },
  { format: 'PCX', count: 10, mib: 0.75, plan: planPcxJobs }
];

export function generateBigFolder(targetMiB, outDir) {
  const targetBytes = Math.round(targetMiB * MIB);
  const rand = mulberry32(0x1B16C0DE);
  const jitter = () => 0.8 + rand() * 0.4;

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, '.gitignore'), '*\n!.gitignore\n');

  const fixedJobs = {};
  let fixedPlanned = 0;
  for (const spec of BIG_FIXED_SPECS) {
    const budget = Math.round(targetBytes * spec.count * spec.mib / BIG_REF_MIB);
    let perFile = Math.min(budget / spec.count, spec.mib * MIB);
    perFile = Math.max(perFile, BIG_MIN_FILE_BYTES);
    const count = Math.max(1, Math.round(budget / perFile));
    const jobs = spec.plan(count, perFile, jitter);
    fixedJobs[spec.format] = jobs;
    for (const job of jobs) fixedPlanned += job.bytes;
  }

  const jpegBudget = Math.max(0, targetBytes - fixedPlanned);
  let jpegJobs = [];
  if (jpegBudget >= 64 * 1024) {
    let count = Math.max(1, Math.round(jpegBudget / (3.25 * MIB)));
    let perFile = Math.min(jpegBudget / count, 4.5 * MIB);
    count = Math.max(1, Math.round(jpegBudget / perFile));
    perFile = Math.min(jpegBudget / count, 4.5 * MIB);
    jpegJobs = planJpegJobs(jpegBudget, perFile, jitter);
  }

  const queues = [jpegJobs, fixedJobs.BMP, fixedJobs.PNG,
                  fixedJobs.TIFF, fixedJobs.GIF, fixedJobs.PCX];
  const ordered = [];
  const cursors = queues.map(() => 0);
  for (;;) {
    let took = false;
    for (let q = 0; q < queues.length; q++) {
      if (cursors[q] < queues[q].length) {
        ordered.push(queues[q][cursors[q]++]);
        took = true;
      }
    }
    if (!took) break;
  }

  const absDir = resolve(outDir);
  console.log('Генерация демо-папки ~' + humanSize(targetBytes) + ' → ' + absDir);
  const stats = {};
  let written = 0;
  let number = 0;
  for (const job of ordered) {
    const name = job.prefix + '-' + String(++number).padStart(4, '0') + '.' + job.ext;
    const bytes = job.write(join(outDir, name));
    const s = stats[job.format] || (stats[job.format] = { count: 0, bytes: 0 });
    s.count++;
    s.bytes += bytes;
    written += bytes;
  }

  for (const format of ['JPEG', 'BMP', 'PNG', 'TIFF', 'GIF', 'PCX']) {
    const s = stats[format] || { count: 0, bytes: 0 };
    console.log(format.padEnd(5) + ': ' + pluralFiles(s.count) + ', ' + humanSize(s.bytes));
  }
  console.log('Готово: ' + pluralFiles(number) + ', ' + humanSize(written) + ' → ' + absDir);
  console.log('Эта папка — набор для демонстрации быстродействия обработки: выберите её в приложении.');
  return { files: number, bytes: written, dir: absDir };
}

function writeTestImages() {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'images');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, '.gitignore'), '*\n!.gitignore\n');
  for (const [name, bytes] of FILES) {
    writeFileSync(join(outDir, name), bytes);
    console.log(name.padEnd(28) + String(bytes.length).padStart(6) + ' байт');
  }
  console.log('Записано файлов: ' + FILES.length + ' → ' + outDir);
}

const USAGE = [
  'Использование:',
  '  node tools/generate-test-images.mjs              20 тестовых файлов → tests/images/',
  '  node tools/generate-test-images.mjs --big [МиБ]  демо-папка для демонстрации быстродействия → demo-folder/',
  '                                                   МиБ — число ≥ 1 (по умолчанию 2048)'
].join('\n');

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    writeTestImages();
  } else if (args[0] === '--big' && args.length <= 2) {
    let mib = BIG_DEFAULT_MIB;
    if (args.length === 2) {
      if (!/^\d+(\.\d+)?$/.test(args[1]) || Number(args[1]) < 1) {
        console.error(USAGE);
        process.exit(1);
      }
      mib = Number(args[1]);
    }
    generateBigFolder(mib, join(dirname(fileURLToPath(import.meta.url)), '..', 'demo-folder'));
  } else {
    console.error(USAGE);
    process.exit(1);
  }
}
