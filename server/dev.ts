import { NodeRuntime } from "@effect/platform-node";
import { Data, Effect } from "effect";
import { spawn, type ChildProcess } from "node:child_process";

class DevProcessError extends Data.TaggedError("DevProcessError")<{
  readonly process: string;
  readonly exitCode: number | null;
}> {}

type NamedChild = { readonly name: string; readonly child: ChildProcess };

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const runDevelopmentWorkbench = Effect.acquireUseRelease(
  Effect.sync(
    (): ReadonlyArray<NamedChild> => [
      {
        name: "server",
        child: spawn(npm, ["run", "dev:server"], { cwd: process.cwd(), stdio: "inherit", env: process.env }),
      },
      {
        name: "client",
        child: spawn(npm, ["run", "dev:client"], { cwd: process.cwd(), stdio: "inherit", env: process.env }),
      },
    ],
  ),
  (children) =>
    Effect.async<void, DevProcessError>((resume) => {
      let settled = false;
      for (const item of children) {
        item.child.once("error", () => {
          if (settled) return;
          settled = true;
          resume(Effect.fail(new DevProcessError({ process: item.name, exitCode: null })));
        });
        item.child.once("exit", (code, signal) => {
          if (settled) return;
          settled = true;
          if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") resume(Effect.void);
          else resume(Effect.fail(new DevProcessError({ process: item.name, exitCode: code })));
        });
      }
    }),
  (children) =>
    Effect.sync(() => {
      for (const { child } of children) if (!child.killed) child.kill("SIGTERM");
    }),
).pipe(Effect.scoped);

runDevelopmentWorkbench.pipe(NodeRuntime.runMain);
