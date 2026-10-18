import { describe, expect, it } from "vitest";

import { groupQuestions, parseVector, percentile, summarizeLog } from "./insights";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`;

describe("frequent questions", () => {
  it("groups questions with close embeddings and counts hand-offs", () => {
    const groups = groupQuestions([
      {
        question: "Can I have a dog?",
        embedding: [1, 0, 0],
        outcome: "answered",
        createdAt: at(1),
      },
      {
        question: "Are dogs allowed?",
        embedding: [0.95, 0.1, 0],
        outcome: "answered",
        createdAt: at(3),
      },
      {
        question: "Can I charge my EV?",
        embedding: [0, 1, 0],
        outcome: "not_found",
        createdAt: at(2),
      },
      {
        question: "can i have a dog? ",
        embedding: [0.99, 0, 0.05],
        outcome: "answered",
        createdAt: at(4),
      },
    ]);
    expect(groups).toEqual([
      {
        question: "can i have a dog? ",
        variants: ["can i have a dog? ", "Are dogs allowed?"],
        count: 3,
        handedOff: 0,
        lastAskedAt: at(4),
      },
      {
        question: "Can I charge my EV?",
        variants: ["Can I charge my EV?"],
        count: 1,
        handedOff: 1,
        lastAskedAt: at(2),
      },
    ]);
  });

  it("reads pgvector's text form", () => {
    expect(parseVector("[0.5,-1,2e-3]")).toEqual([0.5, -1, 0.002]);
    expect(parseVector(null)).toBeNull();
    expect(parseVector("not a vector")).toBeNull();
  });
});

describe("answer log summary", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([], 50)).toBeNull();
  });

  it("totals cost and outcomes", () => {
    expect(
      summarizeLog([
        { outcome: "answered", costMicroUsd: 30_000, totalMs: 3000, firstTokenMs: 1200 },
        { outcome: "not_found", costMicroUsd: 20_000, totalMs: 5000, firstTokenMs: null },
        { outcome: "answered", costMicroUsd: 40_000, totalMs: 4000, firstTokenMs: 1800 },
      ]),
    ).toEqual({
      questions: 3,
      answered: 2,
      handedOff: 1,
      totalCostMicroUsd: 90_000,
      averageCostMicroUsd: 30_000,
      medianMs: 4000,
      p90Ms: 5000,
      medianFirstTokenMs: 1200,
    });
  });
});
