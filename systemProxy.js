"use strict";
const { execFile: execFile } = require("child_process");
const REG = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const BYPASS =
  "<local>;localhost;127.0.0.1;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*";
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
async function setSystemProxy(enable, hostPort) {
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
