import { spawnSync } from "node:child_process";

const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const args = [
  "--experimental-test-module-mocks",
  "--experimental-test-coverage",
  ...(nodeMajorVersion >= 26 ? ["--test-coverage-include-all"] : []),
  "--test",
];

const result = spawnSync(process.execPath, args, { stdio: "inherit" });

if (result.error) {
  console.error("Unable to start the test coverage runner:", result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
