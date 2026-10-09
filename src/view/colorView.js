export class ColorView {
  constructor() {
    this.mainDisplay = document.getElementById("mainDisplay");
    this.warningBanner = document.getElementById("warningBanner");
    this.globalPicker = document.getElementById("globalColorPicker");
    this.illuminantSelect = document.getElementById("illuminantSelect");
    this.gamutStrategySelect = document.getElementById("gamutStrategySelect");
    this.inputs = [...document.querySelectorAll("[data-model][data-channel]")];
    this.numberInputs = [...document.querySelectorAll(".number[data-model][data-channel]")];
    this.pickers = [...document.querySelectorAll("[data-picker]")];
    this.testConsole = document.getElementById("testConsole");
  }

  parseInteger(text) {
    const trimmed = text.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }

  getBounds(element) {
    const min = Number(element.dataset.min ?? element.min);
    const max = Number(element.dataset.max ?? element.max);
    return { min, max };
  }

  onComponentInput(handler) {
    this.inputs.forEach(element => {
      element.addEventListener("input", event => {
        const value = event.target.type === "range"
          ? Math.round(Number(event.target.value))
          : this.parseInteger(event.target.value);

        if (value !== null && Number.isFinite(value)) {
          handler(
            event.target.dataset.model,
            event.target.dataset.channel,
            value,
            this.getBounds(event.target)
          );
        }
      });
    });
  }

  onNumberBlur(handler) {
    this.numberInputs.forEach(element => element.addEventListener("blur", handler));
  }

  onPickerInput(handler) {
    this.globalPicker.addEventListener("input", event => handler(event.target.value));
    this.pickers.forEach(picker => picker.addEventListener("input", event => handler(event.target.value)));
  }

  onIlluminantChange(handler) {
    this.illuminantSelect.addEventListener("change", () => handler(this.illuminantSelect.value));
  }

  onGamutChange(handler) {
    this.gamutStrategySelect.addEventListener("change", () => handler(this.gamutStrategySelect.value));
  }

  render(snapshot) {
    this.setModelValues(snapshot);
    this.setPreview(snapshot.hex);
    this.showWarning(snapshot.warning);
    this.renderGradients(snapshot.gradients);
  }

  setModelValues(state) {
    this.inputs.forEach(element => {
      if (element === document.activeElement && element.classList.contains("number")) return;

      const value = state[element.dataset.model][element.dataset.channel];
      if (element.type === "range") {
        element.value = Math.round(value);
        return;
      }

      element.value = Math.round(value).toString();
    });
  }

  setPreview(hex) {
    this.mainDisplay.style.background = hex;
    this.globalPicker.value = hex;
    this.pickers.forEach(picker => { picker.value = hex; });
  }

  showWarning(message) {
    this.warningBanner.style.display = message ? "block" : "none";
    this.warningBanner.textContent = message;
  }

  renderGradients(gradients) {
    Object.entries(gradients).forEach(([modelName, channels]) => {
      Object.entries(channels).forEach(([channel, stops]) => {
        const slider = document.getElementById(`slider-${modelName}-${channel}`);
        if (!slider) return;

        const stopsCss = stops.map(stop => `${stop.hex} ${stop.pos.toFixed(1)}%`).join(", ");
        slider.style.background = `linear-gradient(to right, ${stopsCss})`;
      });
    });
  }

  renderTests(results) {
    const passed = results.filter(result => result.ok).length;
    const lines = results.map(result => `${result.ok ? "✓" : "✗"} ${result.name}${result.details ? ` — ${result.details}` : ""}`);
    this.testConsole.classList.toggle("fail", passed !== results.length);
    this.testConsole.textContent = `Автоматические микро-тесты Model: ${passed}/${results.length} пройдено\n${lines.join("\n")}`;
  }
}
