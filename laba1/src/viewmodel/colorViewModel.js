import {
  clamp,
  rgbToXyz,
  xyzToRgb,
  xyzToLab,
  labToXyz,
  rgbToHex,
  hexToRgb
} from "../model/colorMath.js";

const BOUNDS = {
  rgb: { r: [0, 255], g: [0, 255], b: [0, 255] },
  xyz: { x: [0, 120], y: [0, 120], z: [0, 120] },
  lab: { l: [0, 100], a: [-128, 127], b: [-128, 127] }
};

export class ColorViewModel {
  constructor() {
    this.config = { illuminant: "D65", gamut: "clipping" };
    this.origin = "rgb";
    this.state = {
      rgb: { r: 99, g: 102, b: 241 },
      xyz: { x: 0, y: 0, z: 0 },
      lab: { l: 0, a: 0, b: 0 }
    };
    this.listeners = [];
    this.warning = "";

    this.recalculateFromRgb();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(item => item !== listener);
    };
  }

  getSnapshot() {
    return {
      rgb: { ...this.state.rgb },
      xyz: { ...this.state.xyz },
      lab: { ...this.state.lab },
      hex: rgbToHex(this.state.rgb),
      warning: this.warning,
      origin: this.origin,
      config: { ...this.config },
      gradients: this.buildGradients()
    };
  }

  notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach(listener => listener(snapshot));
  }

  setComponent(model, channel, value, bounds) {
    const range = bounds ?? BOUNDS[model][channel];
    const min = range.min ?? range[0];
    const max = range.max ?? range[1];
    const bounded = clamp(value, min, max);
    const directOverflow = bounded !== value;

    this.origin = model;
    this.state[model][channel] = bounded;

    this.warning = directOverflow
      ? `Введенное значение ${value} выходит за допустимый диапазон ${min}…${max} и было ограничено.`
      : "";

    if (model === "rgb") {
      this.recalculateFromRgb();
    } else if (model === "xyz") {
      this.warning ||= this.recalculateFromXyz();
    } else {
      this.warning ||= this.recalculateFromLab();
    }

    this.notify();
  }

  setHex(hex) {
    this.origin = "rgb";
    this.state.rgb = hexToRgb(hex);
    this.warning = "";
    this.recalculateFromRgb();
    this.notify();
  }

  setIlluminant(name) {
    this.config.illuminant = name;
    this.origin = "rgb";
    this.warning = "";
    this.recalculateFromRgb();
    this.notify();
  }

  setGamut(strategy) {
    this.config.gamut = strategy;
    this.recalculateFromOrigin();
    this.warning = "";
    this.notify();
  }

  refresh() {
    this.warning = "";
    this.notify();
  }

  recalculateFromOrigin() {
    if (this.origin === "xyz") return this.recalculateFromXyz();
    if (this.origin === "lab") return this.recalculateFromLab();
    this.recalculateFromRgb();
    return "";
  }

  recalculateFromRgb() {
    this.state.rgb = {
      r: clamp(this.state.rgb.r, 0, 255),
      g: clamp(this.state.rgb.g, 0, 255),
      b: clamp(this.state.rgb.b, 0, 255)
    };
    this.state.xyz = rgbToXyz(this.state.rgb, this.config.illuminant);
    this.state.lab = xyzToLab(this.state.xyz, this.config.illuminant);
  }

  recalculateFromXyz() {
    const result = xyzToRgb(this.state.xyz, this.config.illuminant, this.config.gamut);
    this.state.rgb = result.rgb;
    this.state.lab = xyzToLab(this.state.xyz, this.config.illuminant);
    return this.gamutWarning(result);
  }

  recalculateFromLab() {
    this.state.xyz = labToXyz(this.state.lab, this.config.illuminant);
    const result = xyzToRgb(this.state.xyz, this.config.illuminant, this.config.gamut);
    this.state.rgb = result.rgb;
    return this.gamutWarning(result);
  }

  gamutWarning(result) {
    if (!result.overflow) return "";

    const values = `R=${result.raw.r.toFixed(1)}, G=${result.raw.g.toFixed(1)}, B=${result.raw.b.toFixed(1)}`;
    return this.config.gamut === "scaling"
      ? `Цвет вышел за охват sRGB (${values}). Применено Scaling: расширенный диапазон пропорционально сжат в 0…255.`
      : `Цвет вышел за охват sRGB (${values}). Применено Clipping: RGB-компоненты ограничены диапазоном 0…255.`;
  }

  buildGradients() {
    const gradients = {};
    const samples = 10;

    Object.entries(BOUNDS).forEach(([modelName, channels]) => {
      gradients[modelName] = {};

      Object.entries(channels).forEach(([channel, [min, max]]) => {
        const stops = [];

        for (let i = 0; i <= samples; i += 1) {
          const ratio = i / samples;
          const value = min + (max - min) * ratio;
          stops.push({
            hex: rgbToHex(this.rgbForCandidate(modelName, channel, value)),
            pos: ratio * 100
          });
        }

        gradients[modelName][channel] = stops;
      });
    });

    return gradients;
  }

  rgbForCandidate(modelName, channel, value) {
    if (modelName === "rgb") {
      return { ...this.state.rgb, [channel]: value };
    }

    if (modelName === "xyz") {
      const xyz = { ...this.state.xyz, [channel]: value };
      return xyzToRgb(xyz, this.config.illuminant, this.config.gamut).rgb;
    }

    const lab = { ...this.state.lab, [channel]: value };
    const xyz = labToXyz(lab, this.config.illuminant);
    return xyzToRgb(xyz, this.config.illuminant, this.config.gamut).rgb;
  }
}
