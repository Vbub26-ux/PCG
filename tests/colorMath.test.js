import test from "node:test";
import assert from "node:assert/strict";

import {
  applyGamut,
  buildMatrices,
  clamp,
  getWhitePoint,
  hexToRgb,
  labToXyz,
  rgbToHex,
  rgbToXyz,
  xyzToLab,
  xyzToRgb
} from "../src/model/colorMath.js";

const close = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

const closeVector = (actual, expected, tolerance, label = "") => {
  Object.entries(expected).forEach(([key, value]) => {
    assert.ok(
      close(actual[key], value, tolerance),
      `${label}${key}: получено ${actual[key]}, ожидалось ${value} (допуск ${tolerance})`
    );
  });
};

const multiply3 = (a, b) => a.map(row => row.map((_, i) => (
  row[0] * b[0][i] + row[1] * b[1][i] + row[2] * b[2][i]
)));

test("матрица sRGB D65 строится из первичных цветов и белой точки (допуск 2e-4)", () => {
  const { toXyz, fromXyz } = buildMatrices("D65");
  const reference = [
    [0.4123908, 0.3575843, 0.1804808],
    [0.2126390, 0.7151687, 0.0721923],
    [0.0193308, 0.1191948, 0.9505322]
  ];

  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      assert.ok(close(toXyz[i][j], reference[i][j], 2e-4), `toXyz[${i}][${j}]: ${toXyz[i][j]}`);
    }
  }

  const identity = multiply3(toXyz, fromXyz);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const expected = i === j ? 1 : 0;
      assert.ok(close(identity[i][j], expected, 1e-9), `toXyz·fromXyz[${i}][${j}]: ${identity[i][j]}`);
    }
  }
});

test("эталонная таблица RGB → XYZ и RGB → LAB (D65)", () => {
  const cases = [
    { rgb: { r: 255, g: 0, b: 0 }, xyz: { x: 41.24, y: 21.26, z: 1.93 }, lab: { l: 53.24, a: 80.09, b: 67.20 } },
    { rgb: { r: 0, g: 255, b: 0 }, xyz: { x: 35.76, y: 71.52, z: 11.92 }, lab: { l: 87.74, a: -86.18, b: 83.18 } },
    { rgb: { r: 0, g: 0, b: 255 }, xyz: { x: 18.05, y: 7.22, z: 95.05 }, lab: { l: 32.30, a: 79.20, b: -107.86 } }
  ];

  cases.forEach(({ rgb, xyz, lab }) => {
    const actualXyz = rgbToXyz(rgb, "D65");
    closeVector(actualXyz, xyz, 0.02, `XYZ(${rgb.r},${rgb.g},${rgb.b}).`);

    const actualLab = xyzToLab(actualXyz, "D65");
    closeVector(actualLab, lab, 0.02, `LAB(${rgb.r},${rgb.g},${rgb.b}).`);
  });
});

test("белый и черный преобразуются точно", () => {
  const whitePoint = getWhitePoint("D65");

  const whiteXyz = rgbToXyz({ r: 255, g: 255, b: 255 }, "D65");
  closeVector(whiteXyz, whitePoint, 1e-9, "white.");
  closeVector(whiteXyz, { x: 95.05, y: 100.00, z: 108.90 }, 0.02, "white-vs-table.");

  const whiteLab = xyzToLab(whiteXyz, "D65");
  closeVector(whiteLab, { l: 100, a: 0, b: 0 }, 1e-6, "whiteLab.");

  const blackXyz = rgbToXyz({ r: 0, g: 0, b: 0 }, "D65");
  closeVector(blackXyz, { x: 0, y: 0, z: 0 }, 1e-9, "black.");

  const blackLab = xyzToLab(blackXyz, "D65");
  closeVector(blackLab, { l: 0, a: 0, b: 0 }, 1e-9, "blackLab.");
});

test("обратные переходы: XYZ → RGB и LAB → XYZ", () => {
  const backRgb = xyzToRgb({ x: 41.24, y: 21.26, z: 1.93 }, "D65", "clipping");
  closeVector(backRgb.rgb, { r: 255, g: 0, b: 0 }, 0.02, "red.");

  const backXyz = labToXyz({ l: 53.24, a: 80.09, b: 67.20 }, "D65");
  closeVector(backXyz, { x: 41.24, y: 21.26, z: 1.93 }, 0.02, "redXyz.");
});

test("round-trip на сетке с шагом 51 (125 цветов)", () => {
  for (let r = 0; r <= 255; r += 51) {
    for (let g = 0; g <= 255; g += 51) {
      for (let b = 0; b <= 255; b += 51) {
        const rgb = { r, g, b };
        const xyz = rgbToXyz(rgb, "D65");

        const backRgb = xyzToRgb(xyz, "D65", "clipping");
        closeVector(backRgb.rgb, rgb, 1e-6, `rgb(${r},${g},${b}).`);

        const lab = xyzToLab(xyz, "D65");
        const backXyz = labToXyz(lab, "D65");
        closeVector(backXyz, xyz, 1e-9, `xyz(${r},${g},${b}).`);
      }
    }
  }
});

test("выход за охват sRGB: XYZ(0, 100, 0)", () => {
  const clipped = xyzToRgb({ x: 0, y: 100, z: 0 }, "D65", "clipping");
  assert.equal(clipped.overflow, true);
  ["r", "g", "b"].forEach(channel => {
    assert.ok(clipped.rgb[channel] >= 0 && clipped.rgb[channel] <= 255, `clipped.${channel}`);
  });

  const scaled = xyzToRgb({ x: 0, y: 100, z: 0 }, "D65", "scaling");
  assert.equal(scaled.overflow, true);
  ["r", "g", "b"].forEach(channel => {
    assert.ok(scaled.rgb[channel] >= 0 && scaled.rgb[channel] <= 255, `scaled.${channel}`);
  });

  const raw = [scaled.raw.r, scaled.raw.g, scaled.raw.b];
  const sourceMin = Math.min(0, ...raw);
  const sourceMax = Math.max(255, ...raw);
  ["r", "g", "b"].forEach(channel => {
    const expected = (scaled.raw[channel] - sourceMin) * 255 / (sourceMax - sourceMin);
    assert.ok(
      close(scaled.rgb[channel], expected, 1e-9),
      `scaling.${channel}: получено ${scaled.rgb[channel]}, ожидалось ${expected}`
    );
  });
});

test("applyGamut: clipping, scaling и цвета в охвате", () => {
  const scaled = applyGamut({ r: 300, g: -20, b: 100 }, "scaling");
  assert.equal(scaled.overflow, true);
  closeVector(scaled.rgb, { r: 255, g: 0, b: 95.625 }, 1e-9, "scaling.");

  const clipped = applyGamut({ r: 300, g: -20, b: 100 }, "clipping");
  assert.equal(clipped.overflow, true);
  closeVector(clipped.rgb, { r: 255, g: 0, b: 100 }, 1e-9, "clipping.");

  const inside = applyGamut({ r: 10, g: 20, b: 30 }, "scaling");
  assert.equal(inside.overflow, false);
  closeVector(inside.rgb, { r: 10, g: 20, b: 30 }, 0, "inside.");

  assert.equal(clamp(-10, 0, 255), 0);
  assert.equal(clamp(300, 0, 255), 255);
  assert.equal(clamp(128, 0, 255), 128);
});

test("белые точки и различие матриц D65/D50", () => {
  const whiteE = getWhitePoint("E");
  closeVector(whiteE, { x: 100, y: 100, z: 100 }, 1e-9, "E.");

  const d65 = buildMatrices("D65").toXyz;
  const d50 = buildMatrices("D50").toXyz;
  assert.ok(Math.abs(d50[0][0] - d65[0][0]) > 0.01, "матрицы D50 и D65 совпадают");

  assert.throws(() => getWhitePoint("A1"));
  assert.throws(() => buildMatrices("A1"));
});

test("hex-конвертация: round-trip и клампинг", () => {
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0 }), "#ff0000");
  assert.deepEqual(hexToRgb("#6366f1"), { r: 99, g: 102, b: 241 });
  assert.deepEqual(hexToRgb(rgbToHex({ r: 12, g: 200, b: 77 })), { r: 12, g: 200, b: 77 });
  assert.equal(rgbToHex({ r: 300, g: -5, b: 12.6 }), "#ff000d");
});
