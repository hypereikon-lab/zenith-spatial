import { describe, expect, test, vi } from "vitest";
import { createGpuResourceScope } from "./resource-scope.js";

describe("GPU resource scope", () => {
  test("destroys renderer resources and deferred cleanup once in reverse registration order", () => {
    const calls: string[] = [];
    const scope = createGpuResourceScope("test renderer");
    scope.own({ destroy: vi.fn(() => calls.push("resource-a")) });
    scope.own({ destroy: vi.fn(() => calls.push("resource-b")) });
    scope.defer(() => calls.push("cleanup-a"));
    scope.defer(() => calls.push("cleanup-b"));

    scope.destroy();
    scope.destroy();

    expect(calls).toEqual(["cleanup-b", "cleanup-a", "resource-b", "resource-a"]);
    expect(scope.destroyed).toBe(true);
  });

  test("can transfer a resource out before destruction", () => {
    const resource = { destroy: vi.fn() };
    const scope = createGpuResourceScope("transfer");
    scope.release(scope.own(resource));
    scope.destroy();
    expect(resource.destroy).not.toHaveBeenCalled();
  });
});
