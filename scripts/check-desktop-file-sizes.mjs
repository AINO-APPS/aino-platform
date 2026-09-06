import { checkSourceFileSizes } from "./check-source-file-sizes.mjs";

checkSourceFileSizes({
  label: "Desktop",
  root: "desktop",
  baselineFile: "scripts/desktop-file-sizes-baseline.json",
  recursive: false,
});