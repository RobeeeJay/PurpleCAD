// A test's time limit, stretched on slow machines. CI sets TEST_TIME_SCALE:
// its x86-64 runners take three to seven times as long as an Apple Silicon Mac
// on the heavy OCC tests, so a budget sized here times out there.
export const budget = (ms) => ms * Number(process.env.TEST_TIME_SCALE ?? 1);
