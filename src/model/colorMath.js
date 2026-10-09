export const RGB_PRIMARIES = {
  r: { x: 0.64, y: 0.33 },
  g: { x: 0.30, y: 0.60 },
  b: { x: 0.15, y: 0.06 }
};

export const ILLUMINANTS = {
  D65: { x: 0.3127, y: 0.3290 },
  D50: { x: 0.34567, y: 0.35850 },
  E: { x: 1 / 3, y: 1 / 3 }
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const xyToXyz = (x, y, luminance = 1) => ({
  x: x / y * luminance,
  y: luminance,
  z: (1 - x - y) / y * luminance
});

const determinant3 = matrix => (
  matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
  - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
  + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
);

const inverse3 = matrix => {
  const det = determinant3(matrix);
  if (Math.abs(det) < 1e-12) throw new Error("Матрица вырождена и не может быть обращена");

  return [
    [
      (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det,
      (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det,
      (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det
    ],
    [
      (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det,
      (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det,
      (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det
    ],
    [
      (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det,
      (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det,
      (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det
    ]
  ];
};

const multiplyMatrixVector = (matrix, vector) => matrix.map(row => (
  row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
));

export const getWhitePoint = (illuminant, luminance = 100) => {
  const white = ILLUMINANTS[illuminant];
  if (!white) throw new Error(`Неизвестный стандарт освещения: ${illuminant}`);
  return xyToXyz(white.x, white.y, luminance);
};

export const buildMatrices = illuminant => {
  const r = xyToXyz(RGB_PRIMARIES.r.x, RGB_PRIMARIES.r.y);
  const g = xyToXyz(RGB_PRIMARIES.g.x, RGB_PRIMARIES.g.y);
  const b = xyToXyz(RGB_PRIMARIES.b.x, RGB_PRIMARIES.b.y);
  const primaryMatrix = [
    [r.x, g.x, b.x],
    [r.y, g.y, b.y],
    [r.z, g.z, b.z]
  ];
  const white = getWhitePoint(illuminant, 1);
  const scale = multiplyMatrixVector(inverse3(primaryMatrix), [white.x, white.y, white.z]);
  const toXyz = primaryMatrix.map(row => row.map((value, index) => value * scale[index]));

  return { toXyz, fromXyz: inverse3(toXyz) };
};

const srgbDecode = channel => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const srgbEncode = linear => {
  const value = linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055;
  return value * 255;
};

export const applyGamut = (rgb, strategy) => {
  const raw = [rgb.r, rgb.g, rgb.b];
  const overflow = raw.some(value => value < 0 || value > 255 || !Number.isFinite(value));

  if (!overflow) {
    return {
      rgb: { r: raw[0], g: raw[1], b: raw[2] },
      raw: { r: raw[0], g: raw[1], b: raw[2] },
      overflow: false
    };
  }

  const finite = raw.map(value => Number.isFinite(value) ? value : 0);

  if (strategy === "scaling") {
    const sourceMin = Math.min(0, ...finite);
    const sourceMax = Math.max(255, ...finite);
    const range = sourceMax - sourceMin || 1;
    const scaled = finite.map(value => (value - sourceMin) * 255 / range);

    return {
      rgb: {
        r: clamp(scaled[0], 0, 255),
        g: clamp(scaled[1], 0, 255),
        b: clamp(scaled[2], 0, 255)
      },
      raw: { r: raw[0], g: raw[1], b: raw[2] },
      overflow: true
    };
  }

  return {
    rgb: {
      r: clamp(finite[0], 0, 255),
      g: clamp(finite[1], 0, 255),
      b: clamp(finite[2], 0, 255)
    },
    raw: { r: raw[0], g: raw[1], b: raw[2] },
    overflow: true
  };
};

export const rgbToXyz = (rgb, illuminant) => {
  const matrix = buildMatrices(illuminant).toXyz;
  const linearRgb = [srgbDecode(rgb.r), srgbDecode(rgb.g), srgbDecode(rgb.b)];
  const xyz = multiplyMatrixVector(matrix, linearRgb);

  return { x: xyz[0] * 100, y: xyz[1] * 100, z: xyz[2] * 100 };
};

export const xyzToRgb = (xyz, illuminant, strategy) => {
  const matrix = buildMatrices(illuminant).fromXyz;
  const linearRgb = multiplyMatrixVector(matrix, [xyz.x / 100, xyz.y / 100, xyz.z / 100]);
  const rawRgb = {
    r: srgbEncode(linearRgb[0]),
    g: srgbEncode(linearRgb[1]),
    b: srgbEncode(linearRgb[2])
  };

  return applyGamut(rawRgb, strategy);
};

export const xyzToLab = (xyz, illuminant) => {
  const white = getWhitePoint(illuminant);
  const delta = 6 / 29;
  const threshold = delta ** 3;
  const f = value => value > threshold
    ? Math.cbrt(value)
    : value / (3 * delta ** 2) + 4 / 29;
  const fx = f(xyz.x / white.x);
  const fy = f(xyz.y / white.y);
  const fz = f(xyz.z / white.z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
};

export const labToXyz = (lab, illuminant) => {
  const white = getWhitePoint(illuminant);
  const delta = 6 / 29;
  const fInv = value => value > delta
    ? value ** 3
    : 3 * delta ** 2 * (value - 4 / 29);
  const fy = (lab.l + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  return {
    x: white.x * fInv(fx),
    y: white.y * fInv(fy),
    z: white.z * fInv(fz)
  };
};

export const rgbToHex = rgb => {
  const toHex = value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
};

export const hexToRgb = hex => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
});
