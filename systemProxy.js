"use strict";
const { execFile: execFile } = require("child_process");
const REG = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const BYPASS =
  "<local>;localhost;127.0.0.1;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*";

function execCmd(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => {
      resolve(stdout ? stdout.toString() : "");
    });
  });
}

function reg(args) {
  return new Promise((resolve, reject) => {
    execFile("reg", args, { windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function notifyWinInet() {
  const ps =
    "$s=@'\n[DllImport(\"wininet.dll\",SetLastError=true)]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);\n'@;$t=Add-Type -MemberDefinition $s -Name WI -Namespace P -PassThru;$t::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null;$t::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null";
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true },
      () => resolve(),
    );
  });
}

async function getMacNetworkServices() {
  try {
    const out = await execCmd("networksetup", ["-listallnetworkservices"]);
    const lines = out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.filter((s) => !s.startsWith("*") && !s.toLowerCase().includes("denotes"));
  } catch (_) {
    return ["Wi-Fi", "Ethernet"];
  }
}

async function setMacProxy(enable, hostPort) {
  const services = await getMacNetworkServices();
  const list = services.length ? services : ["Wi-Fi", "Ethernet"];
  if (enable && hostPort) {
    const parts = hostPort.split(":");
    const host = parts[0] || "127.0.0.1";
    const port = parts[1] || "7890";
    for (const s of list) {
      await execCmd("networksetup", ["-setwebproxy", s, host, port]);
      await execCmd("networksetup", ["-setsecurewebproxy", s, host, port]);
      await execCmd("networksetup", ["-setsocksfirewallproxy", s, host, port]);
      await execCmd("networksetup", ["-setwebproxystate", s, "on"]);
      await execCmd("networksetup", ["-setsecurewebproxystate", s, "on"]);
      await execCmd("networksetup", ["-setsocksfirewallproxystate", s, "on"]);
    }
  } else {
    for (const s of list) {
      await execCmd("networksetup", ["-setwebproxystate", s, "off"]);
      await execCmd("networksetup", ["-setsecurewebproxystate", s, "off"]);
      await execCmd("networksetup", ["-setsocksfirewallproxystate", s, "off"]);
    }
  }
}

async function setSystemProxy(enable, hostPort) {
  if (process.platform === "darwin") {
    await setMacProxy(enable, hostPort);
    return;
  }
  if (process.platform !== "win32") return;
  if (enable) {
    await reg(["add", REG, "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "1", "/f"]);
    await reg(["add", REG, "/v", "ProxyServer", "/t", "REG_SZ", "/d", hostPort, "/f"]);
    await reg(["add", REG, "/v", "ProxyOverride", "/t", "REG_SZ", "/d", BYPASS, "/f"]);
    await reg(["add", REG, "/v", "ProxyHttp1.1", "/t", "REG_DWORD", "/d", "1", "/f"]);
  } else {
    await reg(["add", REG, "/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f"]);
  }
  await notifyWinInet();
}

module.exports = { setSystemProxy: setSystemProxy };
