// The launch-time update check (electron/updateCheck.cjs).  It must report a
// genuinely newer release and stay silent for everything else: a notice that
// fires for the version already installed, or a check that throws when
// GitHub is unreachable, would be worse than no check at all.
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const { checkForUpdate, isNewer, LATEST_RELEASE_URL } = createRequire(
  import.meta.url,
)("../../../electron/updateCheck.cjs");

const replying =
  (body, { ok = true } = {}) =>
  async (url, init) => {
    replying.last = { url, init };
    return { ok, json: async () => body };
  };

const release = (tag, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/RobeeeJay/PurpleCAD/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe("isNewer", () => {
  it("compares versions part by part as numbers, not as text", () => {
    expect(isNewer("v1.0.10", "1.0.9")).toBe(true);
    expect(isNewer("1.0.9", "1.0.10")).toBe(false);
    expect(isNewer("v2.0.0", "1.9.9")).toBe(true);
  });

  it("treats the same version, with or without a v, as not newer", () => {
    expect(isNewer("v1.0.1", "1.0.1")).toBe(false);
    expect(isNewer("1.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.1", "1.0")).toBe(true);
  });

  it("never calls a tag it cannot read newer", () => {
    expect(isNewer("nightly", "1.0.1")).toBe(false);
    expect(isNewer("v1.1.0-beta", "1.0.1")).toBe(false);
    expect(isNewer("v1.1.0", "dev")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("reports a newer release with its version and page", async () => {
    const found = await checkForUpdate("1.0.1", replying(release("v1.0.2")));
    expect(found).toEqual({
      version: "1.0.2",
      url: "https://github.com/RobeeeJay/PurpleCAD/releases/tag/v1.0.2",
    });
    expect(replying.last.url).toBe(LATEST_RELEASE_URL);
    expect(replying.last.init.headers["User-Agent"]).toBe("PurpleCAD/1.0.1");
  });

  it("says nothing when the latest release is the one running", async () => {
    expect(await checkForUpdate("1.0.1", replying(release("v1.0.1")))).toBe(
      null,
    );
  });

  it("ignores drafts and pre-releases", async () => {
    const draft = release("v9.0.0", { draft: true });
    const pre = release("v9.0.0", { prerelease: true });
    expect(await checkForUpdate("1.0.1", replying(draft))).toBe(null);
    expect(await checkForUpdate("1.0.1", replying(pre))).toBe(null);
  });

  it("says nothing, rather than throwing, when GitHub cannot be reached or refuses", async () => {
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await checkForUpdate("1.0.1", offline)).toBe(null);
    const limited = replying({ message: "rate limit" }, { ok: false });
    expect(await checkForUpdate("1.0.1", limited)).toBe(null);
    expect(await checkForUpdate("1.0.1", replying({}))).toBe(null);
  });
});
