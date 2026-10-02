#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'images');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, '.gitignore'), '*\n!.gitignore\n');
  for (const [name, bytes] of FILES) {
    writeFileSync(join(outDir, name), bytes);
    console.log(name.padEnd(28) + String(bytes.length).padStart(6) + ' байт');
  }
  console.log('Записано файлов: ' + FILES.length + ' → ' + outDir);
}
