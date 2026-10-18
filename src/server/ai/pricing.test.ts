import { describe, expect, it } from "vitest";

import { costMicroUsd } from "./pricing";

const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, embedding: 0 };

describe("answer cost", () => {
  it("prices Opus 5.5 tokens in micro-dollars", () => {
    // 5,000 in × $4/M = $0.02; 800 out × $20/M = $0.016
    expect(costMicroUsd("claude-opus-5-5", { ...none, input: 5000, output: 800 })).toBe(36_000);
  });

  it("charges cache reads at the cache price and writes at 1.25× input", () => {
    expect(costMicroUsd("claude-opus-5-5", { ...none, cacheRead: 10_000 })).toBe(2_000);
    expect(costMicroUsd("claude-opus-5-5", { ...none, cacheWrite: 1_000 })).toBe(5_000);
  });

  it("adds the embedding of the question", () => {
    expect(costMicroUsd("claude-sonnet-5-5", { ...none, embedding: 50 })).toBe(3);
  });

  it("prices an unknown model as Opus so the log never under-reports", () => {
    expect(costMicroUsd("claude-something-new", { ...none, output: 1000 })).toBe(20_000);
  });
});
