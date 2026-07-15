import { loadEnv } from "./env.js";

export function prepareRuntimeEnvironment(): void {
  loadEnv();
}
