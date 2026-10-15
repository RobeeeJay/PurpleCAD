import { useStore } from "../../store";
import { ApiError, defineCommand } from "../registry.js";
import { waitForSettled } from "../settle.js";

defineCommand({
  name: "document.new",
  description:
    "Start a new, empty document. This DISCARDS the current one -- its timeline, bodies and variables -- so it has to be asked for explicitly with discardCurrent: true.",
  input: {
    properties: {
      discardCurrent: {
        type: "boolean",
        description:
          "Must be true: confirms the current document may be thrown away.",
      },
    },
    required: ["discardCurrent"],
  },
  run: async ({ discardCurrent }) => {
    if (discardCurrent !== true)
      throw new ApiError(
        "CONFIRMATION_REQUIRED",
        "document.new discards the current document; pass discardCurrent: true to confirm.",
      );
    useStore.getState().newDocument();
    await waitForSettled();
    return { items: useStore.getState().items.length };
  },
});
