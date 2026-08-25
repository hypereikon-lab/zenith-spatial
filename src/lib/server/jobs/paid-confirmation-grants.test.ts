import { describe, expect, test } from "vitest";
import { paidConfirmationInputDigest } from "$lib/shared/contracts/paid-confirmation";
import { InMemoryPaidConfirmationGrantStore, serverPaidConfirmationInputDigest } from "./paid-confirmation-grants.js";

const confirmationInput = {
  version: 1,
  operatorId: "inpaint-plate-sketch",
  input: {
    prompt: "Repair this fulldome plate.",
    imageDataUrl: "data:image/png;base64,PLATE",
  },
} as const;

describe("paid confirmation grants", () => {
  test("uses the same canonical digest in browser and server runtimes", async () => {
    await expect(paidConfirmationInputDigest(confirmationInput)).resolves.toBe(
      serverPaidConfirmationInputDigest(confirmationInput),
    );
  });

  test("binds a grant to its project, operator, input, and one use", () => {
    const store = new InMemoryPaidConfirmationGrantStore();
    const inputDigest = serverPaidConfirmationInputDigest(confirmationInput);
    const grant = store.issue({
      projectId: "project_a",
      operatorId: "inpaint-plate-sketch",
      inputDigest,
    });

    expect(() =>
      store.consume({
        projectId: "project_a",
        operatorId: "inpaint-plate-sketch",
        inputDigest: `${inputDigest.slice(0, -1)}0`,
        confirmationGrant: grant.confirmationGrant,
      }),
    ).toThrow("does not match");

    store.consume({
      projectId: "project_a",
      operatorId: "inpaint-plate-sketch",
      inputDigest,
      confirmationGrant: grant.confirmationGrant,
    });

    expect(() =>
      store.consume({
        projectId: "project_a",
        operatorId: "inpaint-plate-sketch",
        inputDigest,
        confirmationGrant: grant.confirmationGrant,
      }),
    ).toThrow("fresh confirmation");
  });
});
