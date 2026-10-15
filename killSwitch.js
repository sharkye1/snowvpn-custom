"use strict";
const { execFile: execFile } = require("child_process");
const RULE_PREFIX = "SnowVPN-KS-";
function sh(cmd, args) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true }, (err, out, errout) =>
        resolve({ ok: !err, out: (out || "") + (errout || "") }),
      );
    } catch (e) {
      resolve({ ok: false, out: e.message });
    }
  });
}
const netsh = (args) => sh("netsh", args);
let _engaged = false;
let _gen = 0;
const TUN_RULE_NAME = RULE_PREFIX + "Tun";
async function delTunRule() {
  await sh("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Remove-NetFirewallRule -DisplayName '${TUN_RULE_NAME}' -ErrorAction SilentlyContinue`,
  ]);
}
async function addTunRule(deviceName) {
  if (!deviceName) return { ok: true };
  const esc = deviceName.replace(/'/g, "''");
  const cmd = `New-NetFirewallRule -DisplayName '${TUN_RULE_NAME}' -Direction Outbound -InterfaceAlias '${esc}' -Action Allow -Profile Any | Out-Null`;
  const r = await sh("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd]);
  return { ok: r.ok, out: r.out };
}
async function delRules() {
  for (const n of ["Core", "Loopback", "LAN", "App", "DHCP"]) {
    await netsh(["advfirewall", "firewall", "delete", "rule", "name=" + RULE_PREFIX + n]);
  }
  await delTunRule();
}
async function cleanup() {
  if (process.platform === "darwin") {
    _engaged = false;
    return { ok: true };
  }
  if (process.platform !== "win32") return { ok: true };
  _gen++;
  let polOk = false;
  try {
    const r = await netsh([
      "advfirewall",
      "set",
      "allprofiles",
      "firewallpolicy",
      "blockinbound,allowoutbound",
    ]);
    polOk = !!r.ok;
  } catch (_) {}
  try {
    await delRules();
  } catch (_) {}
  _engaged = false;
  return { ok: polOk };
}
async function firewallAnyOn() {
  if (process.platform !== "win32") return true;
  const r = await sh("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-NetFirewallProfile | Where-Object {$_.Enabled -eq $true} | Measure-Object).Count",
  ]);
  const n = parseInt((r.out || "").trim(), 10);
  return r.ok ? n > 0 : true;
}
async function engage(coreExe, appExe, tunDevice) {
  if (process.platform === "darwin") {
    _engaged = true;
    return { ok: true, fwOff: false };
  }
  if (process.platform !== "win32") return { ok: true };
  const gen = ++_gen;
  await delRules();
  const add = (name, extra) =>
    netsh(
      [
        "advfirewall",
        "firewall",
        "add",
        "rule",
        "name=" + RULE_PREFIX + name,
        "dir=out",
        "action=allow",
        "enable=yes",
        "profile=any",
      ].concat(extra),
    );
  const results = [];
  if (coreExe) results.push(await add("Core", ["program=" + coreExe]));
  if (appExe) results.push(await add("App", ["program=" + appExe]));
  results.push(await add("Loopback", ["remoteip=127.0.0.1"]));
  results.push(await add("LAN", ["remoteip=LocalSubnet,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"]));
  results.push(await add("DHCP", ["protocol=UDP", "remoteport=67,68"]));
  results.push(await addTunRule(tunDevice));
  const failed = results.find((r) => !r.ok);
  if (failed) {
    await cleanup();
    return {
      ok: false,
      error:
        "не удалось добавить правила брандмауэра (нужны права администратора): " +
        String(failed.out || "")
          .trim()
          .slice(0, 200),
    };
  }
  if (gen !== _gen) {
    return { ok: false, error: "отменено отключением" };
  }
  const r = await netsh([
    "advfirewall",
    "set",
    "allprofiles",
    "firewallpolicy",
    "blockinbound,blockoutbound",
  ]);
  if (!r.ok) {
    await cleanup();
    return {
      ok: false,
      error:
        "не удалось применить политику брандмауэра: " +
        String(r.out || "")
          .trim()
          .slice(0, 200),
    };
  }
  if (gen !== _gen) {
    try {
      await netsh([
        "advfirewall",
        "set",
        "allprofiles",
        "firewallpolicy",
        "blockinbound,allowoutbound",
      ]);
      await delRules();
    } catch (_) {}
    return { ok: false, error: "отменено отключением" };
  }
  _engaged = true;
  const fwOn = await firewallAnyOn();
  return { ok: true, fwOff: !fwOn };
}
function isEngaged() {
  return _engaged;
}
const ALLOW_PREFIX = "SnowVPN-Allow-";
async function delAllowRules() {
  if (process.platform !== "win32") return;
  for (const n of ["CoreIn", "CoreOut", "AppIn", "AppOut"]) {
    await netsh(["advfirewall", "firewall", "delete", "rule", "name=" + ALLOW_PREFIX + n]);
  }
}
async function ensureAllowed(coreExe, appExe) {
  if (process.platform !== "win32") return { ok: true };
  await delAllowRules();
  const add = (name, exe, dir) =>
    netsh([
      "advfirewall",
      "firewall",
      "add",
      "rule",
      "name=" + ALLOW_PREFIX + name,
      "dir=" + dir,
      "action=allow",
      "enable=yes",
      "profile=any",
      "program=" + exe,
    ]);
  const results = [];
  if (coreExe) {
    results.push(await add("CoreIn", coreExe, "in"));
    results.push(await add("CoreOut", coreExe, "out"));
  }
  if (appExe) {
    results.push(await add("AppIn", appExe, "in"));
    results.push(await add("AppOut", appExe, "out"));
  }
  const failed = results.find((r) => !r.ok);
  return failed
    ? {
        ok: false,
        error: String(failed.out || "")
          .trim()
          .slice(0, 200),
      }
    : { ok: true };
}
async function forceTunPrivate(deviceName) {
  if (process.platform !== "win32") return { ok: true };
  const cmd = `Get-NetAdapter -Name '${deviceName.replace(/'/g, "''")}' -ErrorAction Stop | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction Stop`;
  for (let i = 0; i < 6; i++) {
    const r = await sh("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd]);
    if (r.ok) return { ok: true };
    await new Promise((res) => setTimeout(res, 500));
  }
  return { ok: false };
}
module.exports = {
  engage: engage,
  cleanup: cleanup,
  isEngaged: isEngaged,
  ensureAllowed: ensureAllowed,
  forceTunPrivate: forceTunPrivate,
};
