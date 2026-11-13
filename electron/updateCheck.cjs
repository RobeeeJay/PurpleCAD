// Asks GitHub for the latest published release and reports it when it is newer
// than the running app.  Drafts and pre-releases never count: GitHub's
// /releases/latest leaves them out.  Any failure (offline, rate limit, a reply
// of the wrong shape) is reported as "nothing new" -- a launch check must never
// get in the way.

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/RobeeeJay/PurpleCAD/releases/latest";

// "v1.0.10" -> [1, 0, 10]; null for anything that is not dotted numbers.
const parseVersion = (v) => {
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(String(v ?? "").trim());
  return m ? m[1].split(".").map(Number) : null;
};

// Compared part by part as numbers: as strings, 1.0.10 sorts before 1.0.9.
const isNewer = (candidate, current) => {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};

// `fetchImpl` is Electron's net.fetch in the app (it honours the system
// proxy) and a stand-in in the tests.
async function checkForUpdate(currentVersion, fetchImpl) {
  try {
    const res = await fetchImpl(LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub refuses API requests that carry no User-Agent.
        "User-Agent": `PurpleCAD/${currentVersion}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const release = await res.json();
    if (release.draft || release.prerelease) return null;
    if (!isNewer(release.tag_name, currentVersion)) return null;
    return {
      version: parseVersion(release.tag_name).join("."),
      url: release.html_url,
    };
  } catch {
    return null;
  }
}

module.exports = { checkForUpdate, isNewer, LATEST_RELEASE_URL };
