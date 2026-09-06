import { checkSourceFileSizes } from "./check-source-file-sizes.mjs";

checkSourceFileSizes({
  label: "Client",
  root: "client/src",
  baselineFile: "scripts/client-file-sizes-baseline.json",
});