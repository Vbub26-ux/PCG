import {
  applyGamut,
  buildMatrices,
  getWhitePoint,
  labToXyz,
  rgbToXyz,
  xyzToLab,
  xyzToRgb
} from "./colorMath.js";

export const runSelfCheck = () => {
  const tests = [];
  const add = (name, ok, details = "") => tests.push({ name, ok, details });
  const close = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

  const d65Matrices = buildMatrices("D65");
  add(
    "D65-матрица RGB→XYZ вычислена из chromaticity-координат",
    close(d65Matrices.toXyz[0][0], 0.4123908, 0.0002)
      && close(d65Matrices.toXyz[1][1], 0.7151687, 0.0002)
      && close(d65Matrices.toXyz[2][2], 0.9505322, 0.0002)
  );

  const red = { r: 255, g: 0, b: 0 };
  const redXyz = rgbToXyz(red, "D65");
  add(
    "RGB(255,0,0) → XYZ(D65)",
    close(redXyz.x, 41.2391, 0.03)
      && close(redXyz.y, 21.2639, 0.03)
      && close(redXyz.z, 1.9331, 0.03),
    `получено (${redXyz.x.toFixed(3)}, ${redXyz.y.toFixed(3)}, ${redXyz.z.toFixed(3)})`
  );

  const redLab = xyzToLab(redXyz, "D65");
  add(
    "RGB(255,0,0) → LAB(D65)",
    close(redLab.l, 53.237, 0.08)
      && close(redLab.a, 80.09, 0.15)
      && close(redLab.b, 67.20, 0.15),
    `получено (${redLab.l.toFixed(3)}, ${redLab.a.toFixed(3)}, ${redLab.b.toFixed(3)})`
  );

  const redRoundTrip = xyzToRgb(redXyz, "D65", "clipping").rgb;
  add(
    "RGB → XYZ → RGB сохраняет красный",
    close(redRoundTrip.r, 255, 0.01)
      && close(redRoundTrip.g, 0, 0.01)
      && close(redRoundTrip.b, 0, 0.01)
  );

  const redXyzRoundTrip = labToXyz(redLab, "D65");
  add(
    "XYZ → LAB → XYZ сохраняет координаты",
    close(redXyzRoundTrip.x, redXyz.x, 0.001)
      && close(redXyzRoundTrip.y, redXyz.y, 0.001)
      && close(redXyzRoundTrip.z, redXyz.z, 0.001)
  );

  const d50Matrices = buildMatrices("D50");
  add(
    "Смена D65→D50 пересчитывает матрицу",
    Math.abs(d65Matrices.toXyz[0][0] - d50Matrices.toXyz[0][0]) > 0.01
  );

  const whiteE = getWhitePoint("E");
  add(
    "Белая точка E вычисляется как XYZ(100,100,100)",
    close(whiteE.x, 100, 1e-9) && close(whiteE.y, 100, 1e-9) && close(whiteE.z, 100, 1e-9)
  );

  const scaled = applyGamut({ r: 300, g: -20, b: 100 }, "scaling");
  add(
    "Scaling помещает цвет в диапазон 0…255",
    scaled.overflow
      && scaled.rgb.r >= 0 && scaled.rgb.r <= 255
      && scaled.rgb.g >= 0 && scaled.rgb.g <= 255
      && scaled.rgb.b >= 0 && scaled.rgb.b <= 255
  );

  return tests;
};
