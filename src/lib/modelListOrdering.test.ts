import { describe, expect, it } from "vitest";
import { orderModelList, splitInstalledModels } from "./modelListOrdering";

interface TestModel {
  id: string;
  label: string;
  active?: boolean;
  installed?: boolean;
  runnable?: boolean;
  downloading?: boolean;
  recommended?: boolean;
  rank?: number;
  latencyMs?: number;
  sizeMb?: number;
}

const accessors = {
  label: (model: TestModel) => model.label,
  active: (model: TestModel) => Boolean(model.active),
  installed: (model: TestModel) => Boolean(model.installed),
  runnable: (model: TestModel) => model.runnable !== false,
  inProgress: (model: TestModel) => Boolean(model.downloading),
  recommended: (model: TestModel) => Boolean(model.recommended),
  rank: (model: TestModel) => model.rank,
  latencyMs: (model: TestModel) => model.latencyMs,
  sizeMb: (model: TestModel) => model.sizeMb,
};

describe("modelListOrdering", () => {
  it("pins the active downloaded model first", () => {
    const models: TestModel[] = [
      { id: "fast", label: "Fast", installed: true, rank: 1 },
      { id: "active", label: "Active", active: true, installed: true, rank: 9 },
    ];

    expect(
      orderModelList(models, "downloaded", "test_score", accessors).map(
        (model) => model.id,
      ),
    ).toEqual(["active", "fast"]);
  });

  it("splits downloaded and available models", () => {
    const models: TestModel[] = [
      { id: "installed", label: "Installed", installed: true },
      { id: "missing", label: "Missing" },
    ];

    expect(splitInstalledModels(models, (model) => Boolean(model.installed))).toEqual({
      downloadedModels: [models[0]],
      availableModels: [models[1]],
    });
  });

  it("orders best match by recommendation, rank, latency, and size", () => {
    const models: TestModel[] = [
      { id: "large", label: "Large", rank: 2, latencyMs: 100, sizeMb: 900 },
      { id: "small", label: "Small", rank: 2, latencyMs: 80, sizeMb: 120 },
      { id: "recommended", label: "Recommended", recommended: true, rank: 5 },
    ];

    expect(
      orderModelList(models, "available", "best_match", accessors).map(
        (model) => model.id,
      ),
    ).toEqual(["recommended", "small", "large"]);
  });

  it("orders alphabetically across the section after active pinning", () => {
    const models: TestModel[] = [
      { id: "recommended-z", label: "Zulu", recommended: true },
      { id: "ranked-b", label: "Beta", rank: 1 },
      { id: "a", label: "Alpha" },
    ];

    expect(
      orderModelList(models, "available", "alphabetical", accessors).map(
        (model) => model.id,
      ),
    ).toEqual(["a", "ranked-b", "recommended-z"]);
  });

  it("falls back to label when test rank is missing", () => {
    const models: TestModel[] = [
      { id: "unranked-a", label: "Alpha" },
      { id: "ranked", label: "Ranked", rank: 2 },
      { id: "unranked-z", label: "Zulu" },
    ];

    expect(
      orderModelList(models, "available", "test_score", accessors).map(
        (model) => model.id,
      ),
    ).toEqual(["ranked", "unranked-a", "unranked-z"]);
  });

  it("orders test scores across the section after active pinning", () => {
    const models: TestModel[] = [
      { id: "recommended", label: "Recommended", recommended: true },
      { id: "ranked", label: "Ranked", rank: 1 },
      { id: "active", label: "Active", active: true },
    ];

    expect(
      orderModelList(models, "available", "test_score", accessors).map(
        (model) => model.id,
      ),
    ).toEqual(["active", "ranked", "recommended"]);
  });
});
