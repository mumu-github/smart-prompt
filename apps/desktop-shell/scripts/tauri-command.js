const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const command = process.argv[2];
const passThroughArgs = process.argv.slice(3);

if (!command || !["dev", "build", "info"].includes(command)) {
  console.error("Usage: node scripts/tauri-command.js <dev|build|info> [...args]");
  process.exit(2);
}

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const separator = process.platform === "win32" ? ";" : ":";
const env = {
  ...process.env,
  PATH: `${cargoBin}${separator}${process.env.PATH || ""}`
};

const tauriBin = process.platform === "win32"
  ? path.resolve(__dirname, "../node_modules/.bin/tauri.cmd")
  : path.resolve(__dirname, "../node_modules/.bin/tauri");
const executable = process.platform === "win32" ? "cmd.exe" : tauriBin;
const args = process.platform === "win32"
  ? ["/d", "/c", "call", tauriBin, command, ...passThroughArgs]
  : [command, ...passThroughArgs];
const child = spawn(executable, args, {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
