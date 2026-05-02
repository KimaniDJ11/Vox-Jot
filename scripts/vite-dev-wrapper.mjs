import { spawn } from "node:child_process";

process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= "true";
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "true";

const BASELINE_WARNING_SNIPPET =
  "[baseline-browser-mapping] The data in this module is over two months old.";

function pipeWithFilter(stream, destination) {
  let buffer = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.includes(BASELINE_WARNING_SNIPPET)) {
        destination.write(`${line}\n`);
      }
    }
  });

  stream.on("end", () => {
    if (buffer && !buffer.includes(BASELINE_WARNING_SNIPPET)) {
      destination.write(buffer);
    }
  });
}

const child = spawn(process.execPath, ["./node_modules/vite/bin/vite.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

pipeWithFilter(child.stdout, process.stdout);
pipeWithFilter(child.stderr, process.stderr);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
