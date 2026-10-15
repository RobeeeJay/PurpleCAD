// The stress plot's colours are a fraction of the material's yield, so the
// material list is not decoration: a wrong number there silently rescales
// every reading the tool has ever shown.
import { describe, it, expect } from "vitest";
import { useStore } from "../../store";
import {
  DEFAULT_STRUCTURAL_MATERIAL,
  STRUCTURAL_MATERIALS,
} from "../stressSlice.js";

describe("structural materials", () => {
  it("offers PETG", () => {
    const petg = STRUCTURAL_MATERIALS.find((m) => m.name === "PETG");
    expect(petg).toBeDefined();
    // Bulk PETG: a couple of GPa, yielding around 50 MPa.
    expect(petg.E).toBeGreaterThan(1500);
    expect(petg.E).toBeLessThan(3000);
    expect(petg.yield).toBeGreaterThan(35);
    expect(petg.yield).toBeLessThan(65);
  });

  it("opens the tool on PETG", () => {
    useStore.setState({
      items: [
        {
          id: 9,
          type: "csg",
          name: "B",
          children: [],
          geometryData: { positions: [0, 0, 0], indices: null },
        },
      ],
    });
    useStore.getState().startStressTool(9);
    expect(useStore.getState().stressTool.params.material).toBe("PETG");
    expect(DEFAULT_STRUCTURAL_MATERIAL).toBe("PETG");
    useStore.getState().cancelStressTool();
  });

  it("gives every material a usable modulus, Poisson ratio and yield", () => {
    // A Poisson ratio at or past 0.5 is incompressible and makes the solve
    // singular; a typo there would not look wrong in a list.
    for (const m of STRUCTURAL_MATERIALS) {
      expect(m.E, `${m.name} modulus`).toBeGreaterThan(100);
      expect(m.nu, `${m.name} Poisson ratio`).toBeGreaterThan(0);
      expect(m.nu, `${m.name} Poisson ratio`).toBeLessThan(0.5);
      expect(m.yield, `${m.name} yield`).toBeGreaterThan(0);
      expect(m.yield, `${m.name} yield`).toBeLessThan(m.E);
    }
  });
});
