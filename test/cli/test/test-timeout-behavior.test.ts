import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}

async function runFixture(fixture: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, path.join(import.meta.dir, fixture)],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { combined: out + err, exitCode };
}

// A timeout kills only what the timed-out test or hook spawned, not processes from hooks or the top of the file (#46373).
test.each([
  {
    name: "test",
    fixture: "process-kill-only-own-fixture.ts",
    failing: "test timeout kills the processes this test spawned",
    passing: "processes spawned before the test survive its timeout",
  },
  {
    name: "test (--isolate)",
    fixture: "process-kill-only-own-fixture.ts",
    args: ["--isolate"],
    failing: "test timeout kills the processes this test spawned",
    passing: "processes spawned before the test survive its timeout",
  },
  {
    name: "test (--parallel)",
    fixture: "process-kill-only-own-fixture.ts",
    args: ["--parallel"],
    failing: "test timeout kills the processes this test spawned",
    passing: "processes spawned before the test survive its timeout",
  },
  {
    name: "beforeEach",
    fixture: "process-kill-hook-timeout-fixture.ts",
    failing: "beforeEach times out > hook timeout kills the processes the hook spawned",
    passing: "process spawned in beforeAll survives the hook timeout",
  },
  {
    name: "spawnSync",
    fixture: "process-kill-spawnsync-fixture.ts",
    failing: "test timeout kills the process spawnSync waits for",
    passing: "process spawned in beforeAll survives the timeout",
  },
])("$name timeout keeps processes spawned before it", async ({ fixture, args = [], failing, passing }) => {
  const { combined, exitCode } = await runFixture(fixture, ...args);
  expect(combined).toContain("killed 1 dangling process");
  expect(combined).toContain(`(fail) ${failing}`);
  expect(combined).toContain(`(pass) ${passing}`);
  expect(exitCode).toBe(1);
});

test("timeouts kill what the timed-out test or hook is responsible for", async () => {
  const { combined, exitCode } = await runFixture("process-kill-cleanup-fixture.ts");
  // a stuck afterEach or afterAll kills what its setup started; concurrent tests are killed when their group ends
  expect(combined).toContain("(pass) processes of timed-out tests and hooks are killed");
  // a stale timer doesn't kill the processes of a test without a timeout
  expect(combined).toContain("(pass) a test without a timeout keeps its processes");
  expect(exitCode).toBe(1);
});

test("--bail kills the processes the skipped afterAll hooks would have stopped", async () => {
  const { combined, exitCode } = await runFixture("process-kill-bail-fixture.ts", "--bail");
  const pid = Number(combined.match(/beforeAll pid (\d+)/)?.[1]);
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    expect(pid).toBeGreaterThan(0);
    expect(combined).toContain("Bailed out after 1 failure");
    while (alive()) await Bun.sleep(10);
    expect(exitCode).toBe(1);
  } finally {
    if (alive()) process.kill(pid);
  }
});
