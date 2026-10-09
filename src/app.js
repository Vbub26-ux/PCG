import { ColorViewModel } from "./viewmodel/colorViewModel.js";
import { ColorView } from "./view/colorView.js";
import { runSelfCheck } from "./model/selfCheck.js";

const view = new ColorView();
const viewModel = new ColorViewModel();

view.onComponentInput((model, channel, value, bounds) => {
  viewModel.setComponent(model, channel, value, bounds);
});

view.onNumberBlur(() => viewModel.refresh());

view.onPickerInput(hex => viewModel.setHex(hex));

view.onIlluminantChange(name => viewModel.setIlluminant(name));

view.onGamutChange(strategy => viewModel.setGamut(strategy));

viewModel.subscribe(snapshot => view.render(snapshot));

view.render(viewModel.getSnapshot());
view.renderTests(runSelfCheck());
