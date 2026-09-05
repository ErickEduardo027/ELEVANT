import { defineConfig } from "orval";

export default defineConfig({
  elevantApi: {
    input: {
      target: "./openapi/elevant-v1.json",
    },
    output: {
      target: "./generated/elevant-api.ts",
      client: "fetch",
      mode: "single",
      clean: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
      },
    },
  },
});
