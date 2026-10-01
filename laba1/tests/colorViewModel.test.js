import test from "node:test";
import assert from "node:assert/strict";

import { ColorViewModel } from "../src/viewmodel/colorViewModel.js";

const close = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance;

test("начальное состояние: #6366f1, D65, clipping, origin rgb", () => {
  const viewModel = new ColorViewModel();
  const snapshot = viewModel.getSnapshot();

  assert.deepEqual(snapshot.rgb, { r: 99, g: 102, b: 241 });
  assert.equal(snapshot.hex, "#6366f1");
  assert.equal(snapshot.origin, "rgb");
  assert.equal(snapshot.warning, "");
  assert.deepEqual(snapshot.config, { illuminant: "D65", gamut: "clipping" });
});

test("setHex(#ff0000) пересчитывает LAB от RGB-источника", () => {
  const viewModel = new ColorViewModel();
  viewModel.setHex("#ff0000");
  const snapshot = viewModel.getSnapshot();

  assert.equal(snapshot.origin, "rgb");
  assert.equal(snapshot.hex, "#ff0000");
  assert.ok(close(snapshot.lab.l, 53.24, 0.02), `l=${snapshot.lab.l}`);
  assert.ok(close(snapshot.lab.a, 80.09, 0.02), `a=${snapshot.lab.a}`);
  assert.ok(close(snapshot.lab.b, 67.20, 0.02), `b=${snapshot.lab.b}`);
  assert.ok(close(snapshot.xyz.x, 41.24, 0.02), `x=${snapshot.xyz.x}`);
  assert.equal(snapshot.warning, "");
});

test("setComponent со значением вне bounds клампит и предупреждает о диапазоне", () => {
  const viewModel = new ColorViewModel();

  viewModel.setComponent("rgb", "r", 300, { min: 0, max: 255 });
  let snapshot = viewModel.getSnapshot();
  assert.equal(snapshot.rgb.r, 255);
  assert.match(snapshot.warning, /диапазон/);

  viewModel.setComponent("lab", "a", -200, { min: -128, max: 127 });
  snapshot = viewModel.getSnapshot();
  assert.equal(snapshot.lab.a, -128);
  assert.match(snapshot.warning, /диапазон/);
});

test("setComponent(xyz) за охватом sRGB: предупреждение и клампинг RGB", () => {
  const viewModel = new ColorViewModel();
  viewModel.setHex("#ffffff");

  viewModel.setComponent("xyz", "x", 0, { min: 0, max: 120 });
  const snapshot = viewModel.getSnapshot();

  assert.equal(snapshot.origin, "xyz");
  assert.ok(snapshot.warning.length > 0);
  assert.match(snapshot.warning, /охват/);
  ["r", "g", "b"].forEach(channel => {
    assert.ok(snapshot.rgb[channel] >= 0 && snapshot.rgb[channel] <= 255, `rgb.${channel}=${snapshot.rgb[channel]}`);
  });
});

test("смена источника света D65 → D50 сохраняет RGB и пересчитывает XYZ/LAB", () => {
  const viewModel = new ColorViewModel();
  viewModel.setHex("#ffffff");
  const rgbBefore = viewModel.getSnapshot().rgb;

  viewModel.setIlluminant("D50");
  const snapshot = viewModel.getSnapshot();

  assert.deepEqual(snapshot.rgb, rgbBefore);
  assert.ok(close(snapshot.xyz.x, 96.42, 0.01), `x=${snapshot.xyz.x}`);
  assert.ok(close(snapshot.lab.l, 100, 1e-6), `l=${snapshot.lab.l}`);
  assert.ok(close(snapshot.lab.a, 0, 1e-6), `a=${snapshot.lab.a}`);
  assert.ok(close(snapshot.lab.b, 0, 1e-6), `b=${snapshot.lab.b}`);
  assert.equal(snapshot.warning, "");
});

test("setGamut пересчитывает от origin и сбрасывает предупреждение", () => {
  const viewModel = new ColorViewModel();
  viewModel.setHex("#ffffff");
  viewModel.setComponent("xyz", "x", 0, { min: 0, max: 120 });
  assert.ok(viewModel.getSnapshot().warning.length > 0);

  viewModel.setGamut("scaling");
  const snapshot = viewModel.getSnapshot();

  assert.deepEqual(snapshot.config, { illuminant: "D65", gamut: "scaling" });
  assert.equal(snapshot.origin, "xyz");
  assert.equal(snapshot.warning, "");
  ["r", "g", "b"].forEach(channel => {
    assert.ok(snapshot.rgb[channel] >= 0 && snapshot.rgb[channel] <= 255, `rgb.${channel}=${snapshot.rgb[channel]}`);
  });
});

test("subscribe доставляет снапшот при каждой команде, отписка работает", () => {
  const viewModel = new ColorViewModel();
  const snapshots = [];
  const unsubscribe = viewModel.subscribe(snapshot => snapshots.push(snapshot));

  viewModel.setHex("#00ff00");
  viewModel.setIlluminant("E");
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].hex, "#00ff00");
  assert.equal(snapshots[1].config.illuminant, "E");

  unsubscribe();
  viewModel.setHex("#0000ff");
  assert.equal(snapshots.length, 2);
});

test("градиенты ползунков считаются от текущего состояния", () => {
  const viewModel = new ColorViewModel();
  viewModel.setHex("#ff0000");

  const stops = viewModel.getSnapshot().gradients.rgb.g;
  assert.equal(stops.length, 11);
  assert.equal(stops[0].hex, "#ff0000");
  assert.equal(stops[10].hex, "#ffff00");
  stops.forEach((stop, index) => {
    assert.equal(stop.pos, index * 10);
  });

  const labStops = viewModel.getSnapshot().gradients.lab.l;
  assert.equal(labStops.length, 11);
});

test("refresh сбрасывает предупреждение без изменения состояния", () => {
  const viewModel = new ColorViewModel();
  viewModel.setComponent("rgb", "r", 999, { min: 0, max: 255 });
  assert.match(viewModel.getSnapshot().warning, /диапазон/);

  viewModel.refresh();
  const snapshot = viewModel.getSnapshot();
  assert.equal(snapshot.warning, "");
  assert.equal(snapshot.rgb.r, 255);
});
