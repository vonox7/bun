import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { echo, type EchoProcess, roundTrip } from "./process-kill-helpers";

// Bun tracks this one under --isolate and --parallel.
const fromTopOfFile = echo();
let fromBeforeAll: EchoProcess;
let fromBeforeEach: EchoProcess | undefined;
let own: EchoProcess;

beforeAll(() => {
  fromBeforeAll = echo();
});

// Spawns once, in the first test's beforeEach.
beforeEach(() => {
  fromBeforeEach ??= echo();
});

afterAll(() => {
  for (const proc of [fromTopOfFile, fromBeforeAll, fromBeforeEach!]) proc.kill();
});

test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
}, 10);

// Its own timeout gives the processes time to start on a slow machine.
test("processes spawned before the test survive its timeout", async () => {
  // Only the timeout's kill ends this process.
  await own.exited;

  for (const proc of [fromTopOfFile, fromBeforeAll, fromBeforeEach!]) {
    expect(await roundTrip(proc)).toBe("ping\n");
  }
}, 30_000);
