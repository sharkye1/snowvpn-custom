"use strict";
const {
  app: app,
  BrowserWindow: BrowserWindow,
  ipcMain: ipcMain,
  net: net,
  shell: shell,
  Tray: Tray,
  Menu: Menu,
  globalShortcut: globalShortcut,
  dialog: dialog,
  nativeImage: nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
let yaml = null;
try {
  yaml = require("js-yaml");
} catch (_) {
  yaml = null;
}
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.setAppUserModelId("com.snowservice.snowvpn");
const ASSETS = path.join(__dirname, "assets");
const ICON = path.join(ASSETS, process.platform === "win32" ? "icon.ico" : "icon.png");
let tray = null;
let isQuitting = false;
process.on("uncaughtException", (e) => {
  console.error("[uncaught]", e && e.message);
});
process.on("unhandledRejection", (e) => {
  console.error("[unhandledRejection]", e && (e.message || e));
});
const SAFE_MODE_FLAG = path.join(app.getPath("userData"), "safe-mode");
let SAFE_MODE = false;
try {
  SAFE_MODE = fs.existsSync(SAFE_MODE_FLAG);
} catch (_) {}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}
const START_MARK = path.join(app.getPath("userData"), "start-mark");
const START_MARK_LIMIT = 3;
let deadStarts = 0;
if (gotLock) {
  try {
    deadStarts = parseInt(fs.readFileSync(START_MARK, "utf8"), 10) || 0;
  } catch (_) {}
  if (!SAFE_MODE && deadStarts >= START_MARK_LIMIT) {
    SAFE_MODE = true;
    try {
      fs.mkdirSync(path.dirname(SAFE_MODE_FLAG), { recursive: true });
      fs.writeFileSync(
        SAFE_MODE_FLAG,
        "auto: " + deadStarts + " стартов подряд без интерфейса\n",
        "utf8",
      );
    } catch (_) {}
  }
  try {
    fs.mkdirSync(path.dirname(START_MARK), { recursive: true });
    fs.writeFileSync(START_MARK, String(deadStarts + 1), "utf8");
  } catch (_) {}
}
function clearStartMark() {
  try {
    fs.unlinkSync(START_MARK);
  } catch (_) {}
}
if (SAFE_MODE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
} else {
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");
}
app.commandLine.appendSwitch("renderer-process-limit", "1");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=192");
app.on("second-instance", (_e, argv) => {
  try {
    showWindow();
  } catch (_) {}
  try {
    handleDeepLinkArgv(argv);
  } catch (_) {}
});
const DEEPLINK_PROTOCOL = "snowvpn";
try {
  if (!app.isDefaultProtocolClient(DEEPLINK_PROTOCOL))
    app.setAsDefaultProtocolClient(DEEPLINK_PROTOCOL);
} catch (_) {}
const os = require("os");
const crypto = require("crypto");
const netNode = require("net");
const { execSync: execSync, spawn: spawn } = require("child_process");
const { CoreBridge: CoreBridge } = require("./coreBridge");
const { setSystemProxy: setSystemProxy } = require("./systemProxy");
const killSwitch = require("./killSwitch");
let _isAdmin = null;
function isAdmin() {
  if (_isAdmin !== null) return _isAdmin;
  if (process.platform === "darwin") {
    _isAdmin = process.getuid ? process.getuid() === 0 : false;
    try {
      const corePath = path.join(__dirname, "core", "SnowVPNCore");
      const st = fs.statSync(corePath);
      if ((st.mode & 0o4000) !== 0 || (process.getuid && process.getuid() === 0)) {
        _isAdmin = true;
      }
    } catch (_) {}
    return _isAdmin;
  }
  if (process.platform !== "win32") {
    _isAdmin = false;
    return _isAdmin;
  }
  try {
    execSync("fltmc", { windowsHide: true, stdio: "ignore" });
    _isAdmin = true;
    return _isAdmin;
  } catch (_) {}
  try {
    const out = execSync(
      'powershell -NoProfile -NonInteractive -Command "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"',
      { windowsHide: true, timeout: 8e3 },
    ).toString();
    if (/true/i.test(out)) {
      _isAdmin = true;
      return _isAdmin;
    }
  } catch (_) {}
  _isAdmin = false;
  return _isAdmin;
}
function relaunchAdmin() {
  if (process.platform === "darwin") {
    const appBundle = process.execPath.split(".app")[0] + ".app";
    const sdir = SETTINGS_DIR.replace(/"/g, '\\"');
    const cmd = `do shell script "open -a \\"${appBundle}\\" --args --settings-dir=\\"${sdir}\\"" with administrator privileges`;
    try {
      spawn("osascript", ["-e", cmd], { detached: true, stdio: "ignore" }).unref();
      console.log("[relaunchAdmin] spawned osascript:", cmd);
    } catch (e) {
      console.log("[relaunchAdmin] error:", e.message);
      return false;
    }
    isQuitting = true;
    try {
      app.releaseSingleInstanceLock();
    } catch (_) {}
    setTimeout(() => {
      try {
        app.exit(0);
      } catch (_) {
        app.quit();
      }
    }, 300);
    return true;
  }
  const exe = process.execPath.replace(/'/g, "''");
  const sdir = SETTINGS_DIR.replace(/'/g, "''");
  const cmd = app.isPackaged
    ? `Start-Process -FilePath '${exe}' -ArgumentList '--settings-dir="${sdir}"' -Verb RunAs`
    : `Start-Process -FilePath '${exe}' -ArgumentList '${app.getAppPath().replace(/'/g, "''")}','--settings-dir="${sdir}"' -Verb RunAs`;
  try {
    const p = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", cmd], {
      detached: true,
      stdio: "ignore",
    });
    p.unref();
    console.log("[relaunchAdmin] spawned:", cmd);
  } catch (e) {
    console.log("[relaunchAdmin] error:", e.message);
    return false;
  }
  isQuitting = true;
  try {
    app.releaseSingleInstanceLock();
  } catch (_) {}
  setTimeout(() => {
    try {
      app.exit(0);
    } catch (_) {
      app.quit();
    }
  }, 300);
  return true;
}
const ADMIN_RETRY_STATE = path.join(app.getPath("userData"), "admin-relaunch.json");
const ADMIN_RETRY_LIMIT = 3;
function loadAdminRetries() {
  try {
    const j = JSON.parse(fs.readFileSync(ADMIN_RETRY_STATE, "utf8"));
    if (j && Number.isFinite(j.n)) return j.n;
  } catch (_) {}
  return 0;
}
function saveAdminRetries(n) {
  try {
    fs.mkdirSync(path.dirname(ADMIN_RETRY_STATE), { recursive: true });
    fs.writeFileSync(ADMIN_RETRY_STATE, JSON.stringify({ n: n }), "utf8");
  } catch (_) {}
}
function clearAdminRetries() {
  try {
    fs.unlinkSync(ADMIN_RETRY_STATE);
  } catch (_) {}
}
let nodeAddrs = {};
function tcpPing(host, port, timeout = 5e3) {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new netNode.Socket();
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch (_) {}
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => fin(Date.now() - start));
    sock.once("timeout", () => fin(-1));
    sock.once("error", () => fin(-1));
    try {
      sock.connect(port, host);
    } catch (_) {
      fin(-1);
    }
  });
}
function buildNodeAddrs(raw) {
  const pkey = "proxies" in raw ? "proxies" : "proxy" in raw ? "proxy" : null;
  const arr = pkey ? raw[pkey] || [] : [];
  nodeAddrs = {};
  arr.forEach((p) => {
    if (p && p.name) nodeAddrs[p.name] = { server: p.server, port: p.port };
  });
}
function readMachineGuid() {
  if (process.platform === "darwin") {
    try {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/ { print $3 }'", {
        encoding: "utf8",
      });
      const g = out.replace(/["\r\n\s]/g, "").trim();
      if (g) return g;
    } catch (_) {}
  }
  if (process.platform === "win32") {
    try {
      const out = execSync(
        "powershell -NoProfile -Command \"(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid\"",
        { encoding: "utf8" },
      );
      const g = out.trim();
      if (g) return g;
    } catch (_) {}
    try {
      const out = execSync("reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid", {
        encoding: "utf8",
      });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/);
      if (m) return m[1].trim();
    } catch (_) {}
  }
  return "";
}
let _hwid = null;
function getHWID() {
  if (_hwid) return _hwid;
  const computerName = process.env.COMPUTERNAME || os.hostname();
  const guid = readMachineGuid();
  const cores = os.cpus().length;
  const memMB = Math.floor(os.totalmem() / (1024 * 1024));
  const deviceId = `${computerName}-${guid}-${cores}-${memMB}`;
  _hwid = crypto
    .createHash("sha256")
    .update(deviceId, "utf8")
    .digest("hex")
    .substring(0, 32)
    .toUpperCase();
  return _hwid;
}
const CORE_DIR = path.join(__dirname, "core");
const CORE_EXE = path.join(
  CORE_DIR,
  process.platform === "win32" ? "SnowVPNCore.exe" : "SnowVPNCore"
);
function coreMismatch() {
  if (process.platform !== "win32") return false;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, "core-manifest.json"), "utf8"));
    if (!m || !m.size) return false;
    return fs.statSync(CORE_EXE).size !== m.size;
  } catch (_) {
    return false;
  }
}
const HOME_DIR = path.join(app.getPath("userData"), "home");
const PROFILES_DIR = path.join(HOME_DIR, "profiles");
const SETTINGS_DIR = (function () {
  const pref = "--settings-dir=";
  const a = process.argv.find((x) => typeof x === "string" && x.startsWith(pref));
  if (a) {
    try {
      return a.slice(pref.length).replace(/^"|"$/g, "");
    } catch (_) {}
  }
  try {
    return path.join(require("os").homedir(), "AppData", "Roaming", "SnowVPN-Client");
  } catch (_) {}
  return path.join(process.env.APPDATA || app.getPath("appData"), "SnowVPN-Client");
})();
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");
const LEGACY_PATHS = [
  path.join(app.getPath("userData"), "settings.json"),
  path.join(path.dirname(app.getPath("exe")), "snowdata", "settings.json"),
];
const GEO_FILES = ["GeoSite.dat", "geoip.metadb"];
const MIXED_PORT = 7897;
const PROXY_HOSTPORT = `127.0.0.1:${MIXED_PORT}`;
const APP_VERSION = "5.1.0";
const SUB_UA = `Clash/Meta; SnowVPN/v${APP_VERSION} Platform/${process.platform === "darwin" ? "macos" : "windows"}`;
const CLIENT_VERSION = "3.1.22";
const UPDATE_URL = "http://45.8.93.251/windows2/update.json";
const CHANGELOG_URL = "http://45.8.93.251/windows2/changelog.json";
const TRUSTED_CERT_THUMBPRINT = "ADDD29689F939F40E1FF1E77688F9E02662DE5E6";
function checkAuthenticodeThumbprint(filePath) {
  if (process.platform !== "win32") return Promise.resolve(true);
  return new Promise((resolve) => {
    const { execFile: execFile } = require("child_process");
    const esc = filePath.replace(/'/g, "''");
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-AuthenticodeSignature -LiteralPath '${esc}').SignerCertificate.Thumbprint`,
      ],
      { windowsHide: true, timeout: 15e3 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(
          String(stdout || "")
            .trim()
            .toUpperCase() || null,
        );
      },
    );
  });
}
let lastUpdateInfo = null;
const RUNTIME_ID = "electron-" + (process.versions.electron || "0");
function cmpVer(a, b) {
  const pa = String(a || "0")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
let win,
  bridge,
  coreReady = null;
let state = {
  running: false,
  netMode: "tun",
  routeMode: "global",
  hasProfile: false,
  activeSub: null,
  currentServer: null,
  proxyPort: MIXED_PORT,
  proxyHostPort: PROXY_HOSTPORT,
};
let proxyTransport = {};
const DEFAULT_SETTINGS = () => ({
  theme: "dark",
  glass: true,
  blur: 40,
  accent: { c: "#3df0e6", g: "linear-gradient(135deg,#41f0e0,#41a0ff)" },
  netMode: "tun",
  tunMigrated: true,
  subs: [],
  activeSub: null,
  selected: {},
  rules: [],
  favorites: [],
  autostart: false,
  aiDns: false,
  aiDnsRegion: "RU",
  ruOptimization: false,
  anim: true,
  routeMode: "global",
  currentServer: null,
  srvSort: "default",
  pingMethod: "http",
  nativeFrame: false,
});
const READ_SOURCES = () =>
  [SETTINGS_PATH, SETTINGS_PATH + ".bak"].concat(LEGACY_PATHS.filter((lp) => lp !== SETTINGS_PATH));
let settingsFileExisted = false;
function parseSettings(raw) {
  const s = JSON.parse(String(raw).replace(/^﻿/, ""));
  if (!s || typeof s !== "object") throw new Error("not an object");
  s.subs = Array.isArray(s.subs) ? s.subs : [];
  s.rules = Array.isArray(s.rules) ? s.rules : [];
  s.selected = s.selected || {};
  s.favorites = Array.isArray(s.favorites) ? s.favorites : [];
  return s;
}
function loadSettings() {
  const srcs = READ_SOURCES();
  try {
    settingsFileExisted = fs.existsSync(SETTINGS_PATH);
  } catch (_) {}
  for (const p of srcs) {
    let raw = null;
    try {
      raw = fs.readFileSync(p, "utf8");
    } catch (_) {
      continue;
    }
    if (raw == null || !raw.trim()) continue;
    try {
      const s = parseSettings(raw);
      if (p !== SETTINGS_PATH)
        diag(
          "loadSettings recovered from " +
            p +
            " subs=" +
            s.subs.length +
            " rules=" +
            s.rules.length,
        );
      return s;
    } catch (e) {
      diag("loadSettings parse FAIL " + p + ": " + e.message);
    }
  }
  return DEFAULT_SETTINGS();
}
const DIAG_PATH = path.join(os.homedir(), "snowvpn-diag.log");
const DIAG_MAX_BYTES = 256 * 1024;
const DIAG_KEEP_BYTES = 48 * 1024;
function ts() {
  const d = new Date(),
    p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes()) +
    ":" +
    p(d.getSeconds())
  );
}
function rotateDiag() {
  try {
    const st = fs.statSync(DIAG_PATH);
    if (st.size <= DIAG_MAX_BYTES) return;
    const fd = fs.openSync(DIAG_PATH, "r");
    const buf = Buffer.alloc(DIAG_KEEP_BYTES);
    fs.readSync(fd, buf, 0, DIAG_KEEP_BYTES, st.size - DIAG_KEEP_BYTES);
    fs.closeSync(fd);
    let tail = buf.toString("utf8");
    const nl = tail.indexOf("\n");
    if (nl >= 0) tail = tail.slice(nl + 1);
    fs.writeFileSync(
      DIAG_PATH,
      "--- лог обрезан при запуске, было " + Math.round(st.size / 1024) + " КБ ---\n" + tail,
    );
  } catch (_) {}
}
rotateDiag();
function diag(m) {
  try {
    fs.appendFileSync(DIAG_PATH, "[" + ts() + "] " + m + "\n");
  } catch (_) {}
}
function readDiskSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    if (raw && raw.trim()) return parseSettings(raw);
  } catch (_) {}
  return null;
}
let _lastBakAt = 0;
function saveSettings(opts) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    const memEmpty =
      !settings.subs || !settings.subs.length || !settings.rules || !settings.rules.length;
    if (!(opts && opts.allowShrink) && memEmpty) {
      const disk = readDiskSettings();
      if (disk) {
        if ((!settings.subs || !settings.subs.length) && disk.subs && disk.subs.length) {
          diag("saveSettings GUARD: restore " + disk.subs.length + " subs (in-mem empty)");
          settings.subs = disk.subs;
          if (!settings.activeSub && disk.activeSub) settings.activeSub = disk.activeSub;
        }
        if ((!settings.rules || !settings.rules.length) && disk.rules && disk.rules.length) {
          diag("saveSettings GUARD: restore " + disk.rules.length + " rules (in-mem empty)");
          settings.rules = disk.rules;
        }
      }
    }
    const payload = JSON.stringify(settings, null, 2);
    try {
      if (Date.now() - _lastBakAt > 5 * 6e4) {
        const prev = fs.readFileSync(SETTINGS_PATH, "utf8");
        if (prev && prev.trim()) {
          try {
            parseSettings(prev);
            fs.writeFileSync(SETTINGS_PATH + ".bak", prev);
            _lastBakAt = Date.now();
          } catch (_) {}
        }
      }
    } catch (_) {}
    const tmp = SETTINGS_PATH + ".tmp";
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, SETTINGS_PATH);
  } catch (e) {
    diag("saveSettings FAIL " + SETTINGS_PATH + ": " + e.message);
  }
}
let settings = loadSettings();
if (!settings.tunMigrated) {
  settings.netMode = "tun";
  settings.tunMigrated = true;
  try {
    saveSettings();
  } catch (_) {}
}
const AUTOSTART_TASK = "SnowVPN_Autostart";
function autostartTaskExists() {
  if (process.platform === "darwin") {
    return !!app.getLoginItemSettings().openAtLogin;
  }
  try {
    return execSync(`schtasks /query /tn "${AUTOSTART_TASK}"`, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .includes(AUTOSTART_TASK);
  } catch (_) {
    return false;
  }
}
function setAutostart(on) {
  if (process.platform === "darwin") {
    try {
      app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true });
    } catch (_) {}
    return true;
  }
  try {
    execSync(`schtasks /delete /tn "${AUTOSTART_TASK}" /f`, { windowsHide: true, stdio: "ignore" });
  } catch (_) {}
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch (_) {}
  if (!on) return true;
  const exe = process.execPath;
  try {
    execSync(
      `schtasks /create /tn "${AUTOSTART_TASK}" /tr "\\"${exe}\\" --tray --settings-dir=\\"${SETTINGS_DIR}\\"" /sc onlogon /rl highest /f`,
      { windowsHide: true, stdio: "ignore" },
    );
    return true;
  } catch (_) {}
  try {
    app.setLoginItemSettings({ openAtLogin: true, args: ["--tray"] });
    return true;
  } catch (_) {
    return false;
  }
}
const LAYERS_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";
function setAlwaysAdmin(on) {
  if (process.platform !== "win32") return true;
  const exe = process.execPath;
  try {
    if (on)
      execSync(`reg add "${LAYERS_KEY}" /v "${exe}" /t REG_SZ /d "~ RUNASADMIN" /f`, {
        windowsHide: true,
        stdio: "ignore",
      });
    else
      execSync(`reg delete "${LAYERS_KEY}" /v "${exe}" /f`, { windowsHide: true, stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}
function getAlwaysAdmin() {
  if (process.platform !== "win32") return true;
  try {
    return execSync(`reg query "${LAYERS_KEY}" /v "${process.execPath}"`, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .includes("RUNASADMIN");
  } catch (_) {
    return false;
  }
}
async function maybeAskAdmin() {
  try {
    if (settings.adminAsked) return;
    settings.adminAsked = true;
    saveSettings();
    if (isAdmin() || getAlwaysAdmin()) return;
    const { dialog: dialog } = require("electron");
    const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : null, {
      type: "question",
      noLink: true,
      defaultId: 0,
      cancelId: 1,
      buttons: ["Да, запускать от администратора", "Позже"],
      title: "Права администратора",
      message: "Запускать SnowVPN от имени администратора?",
      detail:
        "Это нужно для режима TUN — когда весь трафик компьютера (включая игры, Discord, сторонние программы) идёт через VPN. Без прав администратора доступен только режим «Системный прокси» (браузеры и часть приложений).\n\nМожно изменить позже в Настройках.",
    });
    if (r.response === 0) {
      setAlwaysAdmin(true);
      settings.alwaysAdmin = true;
      saveSettings();
      const r2 = await dialog.showMessageBox(win && !win.isDestroyed() ? win : null, {
        type: "question",
        noLink: true,
        defaultId: 0,
        cancelId: 1,
        buttons: ["Перезапустить сейчас", "Позже"],
        title: "Готово",
        message: "Запуск от администратора включён",
        detail: "Применится при следующем запуске SnowVPN. Перезапустить сейчас?",
      });
      if (r2.response === 0) {
        relaunchAdmin();
        setTimeout(() => {
          isQuitting = true;
          try {
            quitClean();
          } catch (_) {
            app.exit(0);
          }
        }, 800);
      }
    }
  } catch (_) {}
}
function autostartCleanLegacy() {
  try {
    const xml = execSync(`schtasks /query /tn "${AUTOSTART_TASK}" /xml`, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const broken =
      /\.vbs|wscript|cscript/i.test(xml) ||
      (process.execPath && !xml.toLowerCase().includes(process.execPath.toLowerCase()));
    if (broken) {
      if (!isAdmin()) {
        diag("autostartCleanLegacy: broken but not admin, skip repair this run");
        return;
      }
      try {
        execSync(`schtasks /delete /tn "${AUTOSTART_TASK}" /f`, {
          windowsHide: true,
          stdio: "ignore",
        });
        diag("legacy autostart removed");
      } catch (_) {}
      if (settings.autostart) setAutostart(true);
    }
  } catch (_) {}
}
async function ksCleanup() {
  const r = await killSwitch.cleanup();
  if (r && r.ok && settings.ksActive) {
    settings.ksActive = false;
    try {
      saveSettings();
    } catch (_) {}
  }
  return r;
}
function forceKillAll() {
  if (process.platform === "darwin") {
    try {
      execSync("killall -9 SnowVPNCore 2>/dev/null || true", { stdio: "ignore" });
    } catch (_) {}
    try {
      setSystemProxy(false);
    } catch (_) {}
    return;
  }
  for (const img of ["SnowVPNCore.exe", "SnowVPNHelperService.exe", "EnableLoopback.exe"]) {
    try {
      execSync(`taskkill /F /T /IM ${img}`, { windowsHide: true, stdio: "ignore" });
    } catch (_) {}
  }
  try {
    execSync(
      'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f',
      { windowsHide: true, stdio: "ignore" },
    );
  } catch (_) {}
  try {
    if (killSwitch.isEngaged() || settings.ksActive) {
      execSync("netsh advfirewall set allprofiles firewallpolicy blockinbound,allowoutbound", {
        windowsHide: true,
        stdio: "ignore",
      });
    }
  } catch (_) {}
}
let _quitting = false;
async function quitClean() {
  if (_quitting) return;
  _quitting = true;
  isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  try {
    await Promise.race([
      (async () => {
        try {
          await disconnect();
        } catch (_) {}
        try {
          if (bridge) await bridge.stop();
        } catch (_) {}
      })(),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch (_) {}
  try {
    await Promise.race([ksCleanup(), new Promise((r) => setTimeout(r, 2500))]);
  } catch (_) {}
  forceKillAll();
  try {
    app.exit(0);
  } catch (_) {
    try {
      app.quit();
    } catch (_) {}
  }
}
function runInstaller(exePath) {
  if (process.platform !== "win32") return;
  const { spawn: spawn } = require("child_process");
  try {
    if (!fs.existsSync(exePath)) {
      diag("runInstaller: файл не найден " + exePath);
      return;
    }
    diag("runInstaller: запуск " + exePath + " (" + fs.statSync(exePath).size + " б)");
  } catch (e) {
    diag("runInstaller stat err: " + e.message);
  }
  try {
    if (bridge) bridge.stop();
  } catch (_) {}
  try {
    forceKillAll();
  } catch (_) {}
  isQuitting = true;
  const installDir = path.dirname(process.execPath);
  diag("runInstaller: exe=" + process.execPath + " installDir=" + installDir);
  const relaunchExe = path.join(installDir, path.basename(process.execPath));
  const vbsPath = path.join(app.getPath("temp"), "snow-update.vbs");
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    "WScript.Sleep 1500",
    'sh.Run "taskkill /F /IM SnowVPN.exe", 0, True',
    'sh.Run "taskkill /F /IM SnowVPNCore.exe", 0, True',
    "WScript.Sleep 900",
    'sh.Run Chr(34) & "' + exePath + '" & Chr(34) & " /D=' + installDir + '", 0, True',
    "WScript.Sleep 1200",
    'sh.Run Chr(34) & "' + relaunchExe + '" & Chr(34), 1, False',
  ].join("\r\n");
  let launched = false;
  try {
    fs.writeFileSync(vbsPath, "\ufeff" + vbs, "ucs2");
    spawn("wscript", [vbsPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    launched = true;
  } catch (e) {
    diag("runInstaller vbs err: " + e.message);
  }
  if (!launched) {
    try {
      spawn(exePath, ["/D=" + installDir], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
      }).unref();
    } catch (e) {
      diag("runInstaller fallback err: " + e.message);
    }
  }
  setTimeout(() => {
    try {
      quitClean();
    } catch (_) {
      app.exit(0);
    }
  }, 400);
}
function ensureDirs() {
  for (const d of [HOME_DIR, PROFILES_DIR]) fs.mkdirSync(d, { recursive: true });
  for (const f of GEO_FILES) {
    const dst = path.join(HOME_DIR, f);
    if (!fs.existsSync(dst)) {
      const src = path.join(CORE_DIR, f);
      if (fs.existsSync(src))
        try {
          fs.copyFileSync(src, dst);
        } catch (e) {}
    }
  }
  state.activeSub = settings.activeSub || (settings.subs[0] && settings.subs[0].id) || null;
  state.netMode = settings.netMode || "tun";
  state.routeMode = settings.routeMode || "global";
  state.currentServer = settings.currentServer || null;
  sanitizeSavedRules();
}
function sanitizeSavedRules() {
  try {
    const arr = settings.rules || [];
    const bad = [];
    for (const r of arr) {
      if (!r || r.enabled === false) continue;
      const v = checkRuleValue(r.type, r.value);
      if (!v.ok) {
        r.enabled = false;
        r.invalid = true;
        r.invalidReason = v.error;
        bad.push(r.name || r.value);
      }
    }
    if (bad.length) {
      saveSettings();
      diag("sanitizeSavedRules disabled " + bad.length + ": " + bad.join(", "));
      setTimeout(() => {
        try {
          send("rule:invalid", { names: bad, rules: settings.rules });
          notify(
            "SnowVPN — отключены некорректные правила",
            bad.slice(0, 3).join(", ") +
              ". Из-за них не загружался список серверов. Проверьте раздел «Правила».",
          );
        } catch (_) {}
      }, 4e3);
    }
  } catch (e) {
    diag("sanitizeSavedRules failed: " + e.message);
  }
}
const profilePath = (id) => path.join(PROFILES_DIR, `${id}.yaml`);
const subById = (id) => settings.subs.find((s) => s.id === id);
const RENDER_FAIL_LIMIT = 3;
const RENDER_FAIL_WINDOW_MS = 6e4;
let rendererFails = 0,
  rendererFailAt = 0;
let winEverShown = false;
const RENDER_FAIL_STATE = path.join(app.getPath("userData"), "render-fails.json");
function loadRenderFails() {
  try {
    const j = JSON.parse(fs.readFileSync(RENDER_FAIL_STATE, "utf8"));
    if (j && Number.isFinite(j.n) && Number.isFinite(j.at)) return j;
  } catch (_) {}
  return null;
}
function saveRenderFails(n, at) {
  try {
    fs.mkdirSync(path.dirname(RENDER_FAIL_STATE), { recursive: true });
  } catch (_) {}
  try {
    fs.writeFileSync(RENDER_FAIL_STATE, JSON.stringify({ n: n, at: at }), "utf8");
  } catch (_) {}
}
function clearRenderFails() {
  try {
    fs.unlinkSync(RENDER_FAIL_STATE);
  } catch (_) {}
}
try {
  const prev = loadRenderFails();
  if (prev && Date.now() - prev.at <= RENDER_FAIL_WINDOW_MS) {
    rendererFails = prev.n;
    rendererFailAt = prev.at;
  } else if (prev) clearRenderFails();
} catch (_) {}
function enableSafeModeAndRestart(d, why) {
  diag(why + " → включаю щадящий режим и перезапускаюсь");
  try {
    fs.mkdirSync(path.dirname(SAFE_MODE_FLAG), { recursive: true });
    fs.writeFileSync(SAFE_MODE_FLAG, ts() + " " + JSON.stringify(d) + "\n", "utf8");
  } catch (_) {}
  let flagOk = false;
  try {
    flagOk = fs.existsSync(SAFE_MODE_FLAG);
  } catch (_) {}
  if (!flagOk) {
    diag(
      "щадящий режим НЕ включился: не удалось записать " + SAFE_MODE_FLAG + " → показываю диалог",
    );
    rendererGiveUp(d);
    return;
  }
  clearRenderFails();
  isQuitting = true;
  try {
    if (bridge) bridge.stop();
  } catch (_) {}
  try {
    forceKillAll();
  } catch (_) {}
  app.relaunch();
  app.exit(0);
}
function onRendererGone(d) {
  const now = Date.now();
  if (!rendererFailAt || now - rendererFailAt > RENDER_FAIL_WINDOW_MS) rendererFails = 0;
  rendererFailAt = now;
  rendererFails++;
  saveRenderFails(rendererFails, rendererFailAt);
  if (d && d.reason === "launch-failed" && !SAFE_MODE) {
    enableSafeModeAndRestart(d, "РЕНДЕРЕР НЕ СМОГ ЗАПУСТИТЬСЯ (launch-failed)");
    return false;
  }
  if (rendererFails < RENDER_FAIL_LIMIT) return true;
  if (!SAFE_MODE) {
    enableSafeModeAndRestart(d, "РЕНДЕРЕР УПАЛ " + rendererFails + " раза подряд");
    return false;
  }
  diag(
    "РЕНДЕРЕР УПАЛ " +
      rendererFails +
      " раза подряд ДАЖЕ В ЩАДЯЩЕМ РЕЖИМЕ → сдаюсь, показываю диалог",
  );
  rendererGiveUp(d);
  return false;
}
function rendererGiveUp(d) {
  let choice = 2;
  try {
    choice = dialog.showMessageBoxSync(null, {
      type: "error",
      noLink: true,
      defaultId: 0,
      cancelId: 2,
      buttons: ["Показать файл диагностики", "Открыть сайт SnowVPN", "Закрыть"],
      title: "SnowVPN — не удаётся открыть окно",
      message: "Интерфейс SnowVPN не запускается на этом компьютере",
      detail:
        "Windows не даёт запустить графическую часть приложения" +
        (d && d.reason ? " (" + d.reason + ")" : "") +
        ". Мы уже пробовали облегчённый режим — не помогло.\n\n" +
        "Обычно виноват антивирус, блокирующий защищённый режим Chromium, либо видеодрайвер.\n\n" +
        "Что помогает:\n" +
        "  • добавить SnowVPN в исключения антивируса;\n" +
        "  • обновить драйвер видеокарты;\n" +
        "  • переустановить SnowVPN с сайта.\n\n" +
        "Подробности записаны в файл:\n" +
        DIAG_PATH,
    });
  } catch (_) {}
  try {
    if (choice === 0) shell.showItemInFolder(DIAG_PATH);
    else if (choice === 1) shell.openExternal("https://snowservice.cc/windows/");
  } catch (_) {}
  try {
    quitClean();
  } catch (_) {
    app.exit(0);
  }
}
let _recreating = false;
function destroyStrayWindows() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === win || w === miniWin) continue;
      if (w.isDestroyed()) continue;
      diag("убираю осиротевшее окно id=" + w.id);
      try {
        w.destroy();
      } catch (_) {}
    }
  } catch (_) {}
}
function recreateWindow(thenShow) {
  if (_recreating) return;
  _recreating = true;
  diag("recreateWindow");
  try {
    if (win && !win.isDestroyed()) win.destroy();
  } catch (_) {}
  win = null;
  destroyStrayWindows();
  createWindow(thenShow);
  destroyStrayWindows();
  setTimeout(() => {
    _recreating = false;
  }, 1500);
}
let saveBoundsTimer = null;
function scheduleSaveBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    try {
      if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
      settings.winBounds = win.getBounds();
      saveSettings();
    } catch (_) {}
  }, 600);
}
function windowBgFor(s) {
  if (s && s.theme === "light") return "#eef5f7";
  return s && s.oled ? "#000000" : "#05121a";
}
function titleBarOverlayFor(s) {
  const light = s && s.theme === "light";
  return { color: windowBgFor(s), symbolColor: light ? "#0c2733" : "#eafcff", height: 36 };
}
function frameOptions() {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      transparent: true,
      backgroundColor: "#00000000",
    };
  }
  if (settings && settings.nativeFrame) {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: titleBarOverlayFor(settings),
      transparent: false,
      backgroundColor: windowBgFor(settings),
    };
  }
  return { frame: false, transparent: true, backgroundColor: "#00000000" };
}
function createWindow(forceShow) {
  if (win && !win.isDestroyed()) {
    diag("createWindow: окно уже есть — показываю существующее вместо создания второго");
    try {
      if (forceShow) {
        win.show();
        win.focus();
        winEverShown = true;
      }
    } catch (_) {}
    return;
  }
  const startHidden = settings.startMinimized || process.argv.includes("--tray");
  let bnds = null;
  try {
    const { screen: screen } = require("electron");
    const saved = settings.winBounds;
    if (
      saved &&
      typeof saved.x === "number" &&
      typeof saved.y === "number" &&
      saved.width > 0 &&
      saved.height > 0
    ) {
      const onScreen = screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return (
          saved.x < w.x + w.width &&
          saved.x + saved.width > w.x &&
          saved.y < w.y + w.height &&
          saved.y + saved.height > w.y
        );
      });
      if (onScreen) bnds = saved;
    }
    if (!bnds) {
      const disp =
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
      const wa = disp.workArea;
      const w = Math.min(1040, Math.max(720, wa.width - 80));
      const h = Math.min(720, Math.max(520, wa.height - 80));
      bnds = {
        width: w,
        height: h,
        x: Math.round(wa.x + (wa.width - w) / 2),
        y: Math.round(wa.y + (wa.height - h) / 2),
      };
    }
  } catch (_) {}
  win = new BrowserWindow(
    Object.assign(
      {
        width: 1040,
        height: 720,
        minWidth: 760,
        minHeight: 520,
        ...frameOptions(),
        resizable: true,
        hasShadow: true,
        title: "SnowVPN",
        show: false,
        icon: fs.existsSync(ICON) ? ICON : undefined,
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: true,
        },
      },
      bnds || {},
    ),
  );
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (forceShow || !startHidden) {
      try {
        if (fs.existsSync(ICON)) win.setIcon(ICON);
      } catch (_) {}
      try {
        win.show();
        win.focus();
        winEverShown = true;
      } catch (_) {}
    }
  });
  win.webContents.on("did-finish-load", () => {
    if (rendererFails) {
      rendererFails = 0;
      clearRenderFails();
    }
    clearStartMark();
  });
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2)
      diag("RENDERER-ERR: " + message + " @" + (sourceId || "").split("/").pop() + ":" + line);
  });
  win.webContents.on("render-process-gone", (_e, d) => {
    diag("РЕНДЕР УПАЛ: " + JSON.stringify(d));
    if (!isQuitting && onRendererGone(d)) recreateWindow(true);
  });
  win.webContents.on("unresponsive", () => {
    diag("win unresponsive");
    try {
      win.webContents.reloadIgnoringCache();
    } catch (_) {}
  });
  win.on("move", scheduleSaveBounds);
  win.on("resize", scheduleSaveBounds);
  win.on("close", (e) => {
    scheduleSaveBounds();
    if (isQuitting) return;
    if (settings.closeToTray !== false) {
      e.preventDefault();
      win.hide();
    } else {
      quitClean();
    }
  });
  if (!createWindow._ipcRegistered) {
    createWindow._ipcRegistered = true;
    ipcMain.on("win:minimize", () => {
      try {
        win.minimize();
      } catch (_) {}
    });
    ipcMain.on("win:maximize", () => {
      try {
        win.isMaximized() ? win.unmaximize() : win.maximize();
      } catch (_) {}
    });
    ipcMain.on("win:close", () => {
      if (settings.closeToTray !== false) {
        try {
          win.hide();
        } catch (_) {}
      } else quitClean();
    });
  }
}
function setupTray() {
  if (tray) return;
  try {
    const iconExists = fs.existsSync(ICON);
    if (!iconExists) diag("setupTray: icon.ico NOT FOUND at " + ICON);
    const img = iconExists ? nativeImage.createFromPath(ICON) : nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip("SnowVPN");
    refreshTray();
    let lastClick = 0;
    tray.on("click", () => {
      const now = Date.now();
      if (now - lastClick < 400) return;
      lastClick = now;
      toggleWindow();
    });
    tray.on("double-click", showWindow);
  } catch (e) {
    console.log("tray", e.message);
  }
}
function isReallyVisible() {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
  try {
    const { screen: screen } = require("electron");
    const b = win.getBounds();
    return screen.getAllDisplays().some((d) => {
      const w = d.workArea;
      return (
        b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y
      );
    });
  } catch (_) {
    return true;
  }
}
function toggleWindow() {
  if (isReallyVisible()) {
    try {
      win.hide();
    } catch (_) {}
    return;
  }
  showWindow();
}
function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow(true);
    return;
  }
  try {
    if (win.webContents.isCrashed()) {
      recreateWindow(true);
      return;
    }
  } catch (_) {}
  try {
    if (win.isMinimized()) win.restore();
    try {
      const { screen: screen } = require("electron");
      const b = win.getBounds();
      const onScreen = screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return (
          b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y
        );
      });
      if (!onScreen) win.center();
    } catch (_) {}
    try {
      win.setOpacity(1);
    } catch (_) {}
    try {
      if (fs.existsSync(ICON)) win.setIcon(ICON);
    } catch (_) {}
    win.show();
    winEverShown = true;
    if (rendererFails) {
      rendererFails = 0;
      clearRenderFails();
    }
    win.moveTop();
    win.setAlwaysOnTop(true);
    win.focus();
    setTimeout(() => {
      try {
        win.setAlwaysOnTop(false);
      } catch (_) {}
    }, 350);
    try {
      win.webContents.invalidate();
    } catch (_) {}
    if (win.webContents) win.webContents.send("win:shown");
  } catch (e) {
    diag("showWindow err: " + e.message);
  }
}
const TRAY_SKIP = ["DIRECT", "REJECT", "REJECT-DROP", "PASS", "GLOBAL", "COMPATIBLE"];
function trayGroup() {
  return (lastGroups || [])
    .slice()
    .sort((a, b) => (b.all ? b.all.length : 0) - (a.all ? a.all.length : 0))[0];
}
function trayServers(grp) {
  return ((grp && grp.all) || []).filter((p) => p && p.name && !TRAY_SKIP.includes(p.name));
}
async function nextServer() {
  try {
    let grp = trayGroup();
    if (!grp) {
      try {
        lastGroups = await getProxyGroups();
      } catch (_) {}
      grp = trayGroup();
    }
    const names = trayServers(grp).map((p) => p.name);
    if (!names.length) return;
    const idx = names.indexOf(state.currentServer || (grp && grp.now));
    const next = names[(idx + 1) % names.length];
    await selectServer(grp.name, next);
    notify("SnowVPN — сервер переключён", cleanSrvName(next));
  } catch (_) {}
}
function refreshTray() {
  if (!tray) return;
  const items = [
    { label: state.running ? "● Подключено" : "○ Отключено", enabled: false },
    { type: "separator" },
    { label: "Открыть SnowVPN", click: showWindow },
    {
      label: "Мини-окно",
      click: () => {
        try {
          openMini();
        } catch (_) {}
      },
    },
    {
      label: state.running ? "Отключить" : "Подключить",
      click: async () => {
        try {
          state.running ? await disconnect() : await connect();
          refreshTray();
        } catch (e) {
          send("vpn:state", state);
        }
      },
    },
  ];
  try {
    const grp = trayGroup();
    if (grp && grp.all && grp.all.length) {
      const now = grp.now || state.currentServer;
      const servers = trayServers(grp)
        .slice()
        .sort((a, b) => (a.delay > 0 ? a.delay : Infinity) - (b.delay > 0 ? b.delay : Infinity));
      const sub = servers.slice(0, 90).map((p) => ({
        label: p.name + (p.delay > 0 ? "  · " + p.delay + " ms" : ""),
        type: "radio",
        checked: p.name === now,
        icon: flagIcon(p.name),
        click: () => {
          selectServer(grp.name, p.name).catch(() => {});
        },
      }));
      if (sub.length) items.push({ type: "separator" }, { label: "Сменить сервер", submenu: sub });
    }
  } catch (_) {}
  items.push(
    { type: "separator" },
    {
      label: "Выход",
      click: () => {
        quitClean();
      },
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send(channel, payload);
  if (channel === "vpn:state") refreshTray();
}
let miniWin = null,
  _miniBoundsTimer = null;
function miniVisible() {
  return !!(miniWin && !miniWin.isDestroyed() && miniWin.isVisible());
}
function createMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) {
    try {
      miniWin.show();
      miniWin.focus();
    } catch (_) {}
    return;
  }
  const b = settings.miniBounds || {};
  const opts = {
    width: 252,
    height: 128,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    title: "SnowVPN Mini",
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  try {
    const { screen: screen } = require("electron");
    if (
      Number.isFinite(b.x) &&
      Number.isFinite(b.y) &&
      screen.getAllDisplays().some((d) => {
        const w = d.workArea;
        return (
          b.x >= w.x - 40 &&
          b.x < w.x + w.width - 40 &&
          b.y >= w.y - 20 &&
          b.y < w.y + w.height - 40
        );
      })
    ) {
      opts.x = b.x;
      opts.y = b.y;
    }
  } catch (_) {}
  miniWin = new BrowserWindow(opts);
  miniWin.loadFile(path.join(__dirname, "renderer", "mini.html"));
  miniWin.once("ready-to-show", () => {
    try {
      miniWin.show();
    } catch (_) {}
  });
  try {
    miniWin.setAlwaysOnTop(true, "screen-saver");
  } catch (_) {}
  miniWin.on("move", () => {
    clearTimeout(_miniBoundsTimer);
    _miniBoundsTimer = setTimeout(() => {
      try {
        const p = miniWin.getPosition();
        settings.miniBounds = { x: p[0], y: p[1] };
        saveSettings();
      } catch (_) {}
    }, 600);
  });
  miniWin.on("closed", () => {
    miniWin = null;
  });
}
function openMini() {
  createMiniWindow();
  try {
    if (win && !win.isDestroyed()) win.hide();
  } catch (_) {}
}
function closeMini(showMain) {
  try {
    if (miniWin && !miniWin.isDestroyed()) miniWin.close();
  } catch (_) {}
  miniWin = null;
  if (showMain) {
    try {
      showWindow();
    } catch (_) {}
  }
}
async function ensureCore() {
  if (bridge && bridge.isAlive() && bridge.isInit) return bridge;
  if (coreReady) return coreReady;
  coreReady = (async () => {
    if (!fs.existsSync(CORE_EXE)) throw new Error("SnowVPNCore не найден в /core");
    if (bridge) {
      try {
        await bridge.stop();
      } catch (_) {}
      bridge = null;
    }
    state.hasProfile = false;
    const b = new CoreBridge({
      coreExe: CORE_EXE,
      coreDir: CORE_DIR,
      homeDir: HOME_DIR,
      version: 20,
      onLog: diag,
    });
    b.on("message", (m) => {
      if (m && m.type === "log") send("core:log", m.data);
      if (m && m.type === "delay") send("core:delay", m.data);
    });
    b.on("core-exit", () => {
      const was = state.running;
      state.running = false;
      try {
        saveSettings();
      } catch (_) {}
      try {
        b.stop();
      } catch (_) {}
      if (bridge === b) bridge = null;
      if (was && !isQuitting && !userDisconnected) {
        notify(
          "SnowVPN — соединение разорвано",
          settings.autoReconnect === false ? "VPN отключился" : "Переподключаюсь…",
        );
        scheduleReconnect();
      } else {
        state.status = "disconnected";
        send("vpn:state", state);
      }
    });
    await b.start();
    await b.init();
    b.startLog().catch(() => {});
    bridge = b;
    return b;
  })();
  coreReady.catch(() => {
    coreReady = null;
  });
  const r = await coreReady;
  coreReady = null;
  return r;
}
const TUN_DEVICE = process.platform === "win32" ? "SnowVPN Tun V2" : "";
function tunSchema(enable) {
  return {
    enable: enable,
    device: TUN_DEVICE,
    stack: "mixed",
    "dns-hijack": ["any:53"],
    "auto-route": true,
    "route-address": [],
  };
}
function injectTun(raw) {
  raw.tun = Object.assign({}, raw.tun && typeof raw.tun === "object" ? raw.tun : {}, {
    enable: false,
    device: TUN_DEVICE,
    stack: "mixed",
    "dns-hijack": ["any:53"],
    "auto-route": true,
    "strict-route": false,
    "auto-detect-interface": true,
    "endpoint-independent-nat": true,
    "route-address": [],
  });
  return raw;
}
function isValidCidr(v) {
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/.exec(v);
  if (m4) {
    const octets = [m4[1], m4[2], m4[3], m4[4]].map(Number);
    if (octets.some((o) => o > 255)) return false;
    if (m4[6] !== undefined && Number(m4[6]) > 32) return false;
    return true;
  }
  if (v.includes(":") && /^[0-9a-fA-F:]+(\/\d{1,3})?$/.test(v)) return true;
  return false;
}
function _pbVarint(b, p) {
  let r = 0,
    s = 0,
    byte;
  do {
    if (p >= b.length) throw new Error("varint out of range");
    byte = b[p++];
    r += (byte & 127) * Math.pow(2, s);
    s += 7;
  } while (byte & 128);
  return [r, p];
}
let _geoSites = null;
function geoSiteCategories() {
  if (_geoSites) return _geoSites;
  const set = new Set();
  try {
    const file = [path.join(HOME_DIR, "GeoSite.dat"), path.join(CORE_DIR, "GeoSite.dat")].find(
      (p) => fs.existsSync(p),
    );
    if (!file) return null;
    const buf = fs.readFileSync(file);
    let p = 0;
    while (p < buf.length) {
      let key;
      [key, p] = _pbVarint(buf, p);
      if ((key & 7) !== 2) break;
      let len;
      [len, p] = _pbVarint(buf, p);
      const end = p + len;
      if (end > buf.length) break;
      if (key >>> 3 === 1) {
        let q = p,
          k2;
        [k2, q] = _pbVarint(buf, q);
        if (k2 >>> 3 === 1 && (k2 & 7) === 2) {
          let l2;
          [l2, q] = _pbVarint(buf, q);
          set.add(
            buf
              .slice(q, q + l2)
              .toString("utf8")
              .toLowerCase(),
          );
        }
      }
      p = end;
    }
  } catch (e) {
    diag("geoSiteCategories failed: " + e.message);
  }
  if (!set.size) return null;
  _geoSites = set;
  return _geoSites;
}
function closestGeoSite(v, cats) {
  let best = null,
    bestD = 4;
  const lev = (a, b) => {
    if (Math.abs(a.length - b.length) >= bestD) return bestD;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
      prev = cur;
    }
    return prev[b.length];
  };
  for (const c of cats) {
    if (Math.abs(c.length - v.length) > 3) continue;
    const d = lev(v, c);
    if (d < bestD) {
      bestD = d;
      best = c;
      if (d === 1) break;
    }
  }
  return best;
}
function punyDomain(s) {
  const v = String(s == null ? "" : s);
  if (!/[^\x00-\x7F]/.test(v)) return v;
  try {
    return require("url").domainToASCII(v) || null;
  } catch (_) {
    return null;
  }
}
function checkRuleValue(type, value) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return { ok: false, error: "Укажите значение" };
  if (v.includes(","))
    return { ok: false, error: "Запятая недопустима — она ломает формат правила" };
  if (/[\r\n\t]/.test(v))
    return { ok: false, error: "Значение не должно содержать переводов строк" };
  switch (type) {
    case "process":
      if (/[\\/]/.test(v))
        return { ok: false, error: "Нужно только имя файла (Telegram.exe), без пути к нему" };
      if (/[<>:"|?*]/.test(v)) return { ok: false, error: "Недопустимые символы в имени процесса" };
      return { ok: true };
    case "domainSuffix":
    case "domainKeyword": {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v))
        return { ok: false, error: "Уберите http:// — нужен только домен" };
      if (v.includes("/")) return { ok: false, error: "Уберите путь после домена" };
      if (/\s/.test(v)) return { ok: false, error: "Домен не может содержать пробелов" };
      const hasLeadingDot = /^[*+]?\./.test(v);
      const bare = v.replace(/^[*+]?\./, "");
      const ascii = punyDomain(bare);
      if (ascii === null) return { ok: false, error: "Не удалось распознать домен" };
      if (!/^[a-z0-9_*-]+(\.[a-z0-9_*-]+)*$/i.test(ascii))
        return { ok: false, error: "Недопустимые символы в домене" };
      if (
        type === "domainSuffix" &&
        !hasLeadingDot &&
        !bare.includes(".") &&
        !(bare.length <= 4 && /^[a-z]+$/i.test(bare))
      ) {
        return {
          ok: false,
          error:
            "Так правило не сработает. Нужен либо полный адрес (" +
            bare +
            ".ru), либо суффикс с точкой (." +
            bare +
            "), либо тип «Слово в домене»",
        };
      }
      return { ok: true };
    }
    case "geoSite": {
      if (!/^[a-z0-9!@_.-]+$/i.test(v))
        return { ok: false, error: "В категории допустимы только латиница, цифры, «-» и «_»" };
      const cats = geoSiteCategories();
      if (!cats) return { ok: true };
      const bare = v.toLowerCase().replace(/^!/, "").split("@")[0];
      if (cats.has(bare)) return { ok: true };
      const near = closestGeoSite(bare, cats);
      return {
        ok: false,
        suggest: near || null,
        error:
          "В GeoSite.dat нет категории «" +
          bare +
          "»" +
          (near
            ? ". Возможно, вы имели в виду «" + near + "»?"
            : " — выберите её кнопкой «Список»"),
      };
    }
    case "geoIp":
      if (!/^[a-z0-9_-]+$/i.test(v))
        return { ok: false, error: "В коде GeoIP допустимы только латиница, цифры, «-» и «_»" };
      return { ok: true };
    case "ipCidr":
      if (v === "0.0.0.0/0" || v === "::/0") return { ok: true };
      if (!isValidCidr(v))
        return { ok: false, error: "Не похоже на IP-адрес или подсеть. Пример: 104.16.0.0/12" };
      return { ok: true };
    default:
      return { ok: false, error: "Неизвестный тип правила" };
  }
}
async function coreCheckRule(type, value) {
  const line = ruleLine({ type: type, value: value, action: "no" }, "DIRECT", new Set(["DIRECT"]));
  if (!line) return { ok: false, error: "Значение отклонено — проверьте формат" };
  if (!bridge || !bridge.isAlive() || !bridge.isInit) return { ok: true, skipped: true };
  const probe = {
    "mixed-port": MIXED_PORT,
    mode: "rule",
    "log-level": "silent",
    proxies: [],
    "proxy-groups": [],
    rule: [line, "MATCH,DIRECT"],
  };
  try {
    const err = await bridge.validateConfig(JSON.stringify(probe));
    if (!err) return { ok: true };
    return { ok: false, error: String(err).replace(/\s+/g, " ").trim().slice(0, 200) };
  } catch (_) {
    return { ok: true, skipped: true };
  }
}
async function validateRule(rule) {
  const r = rule || {};
  const st = checkRuleValue(r.type, r.value);
  if (!st.ok) return st;
  return await coreCheckRule(r.type, r.value);
}
function ruleLine(r, vpnTarget, names, commaAlias) {
  let target;
  if (r.action === "no") target = "DIRECT";
  else if (r.action === "block") target = "REJECT";
  else if (r.proxy && names.has(r.proxy)) {
    const alias = commaAlias && commaAlias.get(r.proxy);
    target = alias || (r.proxy.includes(",") ? vpnTarget : r.proxy);
  } else target = vpnTarget;
  const v = (r.value || "").trim();
  if (!v) return null;
  if (v.includes(",")) return null;
  switch (r.type) {
    case "process":
      return `PROCESS-NAME,${v},${target}`;
    case "domainSuffix": {
      const d = punyDomain(v.replace(/^[*+]?\./, ""));
      return d ? `DOMAIN-SUFFIX,${d},${target}` : null;
    }
    case "domainKeyword": {
      const d = punyDomain(v);
      return d ? `DOMAIN-KEYWORD,${d},${target}` : null;
    }
    case "geoSite":
      return `GEOSITE,${v},${target}`;
    case "geoIp":
      return `GEOIP,${v},${target},no-resolve`;
    case "ipCidr":
      if (v === "0.0.0.0/0" || v === "::/0") return `MATCH,${target}`;
      if (!isValidCidr(v)) return null;
      return `IP-CIDR,${v},${target},no-resolve`;
    default:
      return null;
  }
}
function parseAmneziaConf(text) {
  const out = { type: "wireguard", udp: true, "remote-dns-resolve": true };
  const awg = {};
  let section = "";
  let invalidAwgBoolean = false;
  String(text || "")
    .split(/\r?\n/)
    .forEach((lineRaw) => {
      const line = lineRaw.trim();
      if (!line || line[0] === "#" || line[0] === ";") return;
      const sec = line.match(/^\[([A-Za-z]+)\]$/);
      if (sec) {
        section = sec[1].toLowerCase();
        return;
      }
      const eq = line.indexOf("=");
      if (eq < 0) return;
      const key = line.slice(0, eq).trim().toLowerCase();
      const val = line.slice(eq + 1).trim();
      if (!val) return;
      const list = () =>
        val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      const num = () => {
        const n = parseInt(val, 10);
        return isNaN(n) ? null : n;
      };
      if (section === "interface") {
        if (key === "privatekey") out["private-key"] = val;
        else if (key === "address")
          list().forEach((a) => {
            const ip = a.split("/")[0].trim();
            if (ip.indexOf(":") >= 0) out.ipv6 = ip;
            else out.ip = ip;
          });
        else if (key === "dns") out.dns = list();
        else if (key === "mtu") {
          const n = num();
          if (n > 0) out.mtu = n;
        } else if (/^(jc|jmin|jmax|s1|s2|s3|s4)$/.test(key)) {
          const n = num();
          if (n !== null) awg[key] = n;
        } else if (/^h[1-4]$/.test(key)) awg[key] = val;
        else if (/^i[1-5]$/.test(key)) awg[key] = val;
        else if (key === "headerprotectionkey") awg["header-protection-key"] = val;
        else if (key === "contentpaddingaddition") awg["content-padding-addition"] = val;
        else if (key === "rekeyaftertime") awg["rekey-after-time"] = val;
        else if (key === "rekeytimeout") awg["rekey-timeout"] = val;
        else if (key === "rejectaftertime") awg["reject-after-time"] = val;
        else if (key === "keepalivetimeout") awg["keepalive-timeout"] = val;
        else if (key === "maxhandshakeattempts") awg["max-handshake-attempts"] = val;
        else if (key === "randomtrailers" || key === "disablecookies") {
          const normalized = val.toLowerCase();
          if (/^(1|true|yes|on)$/.test(normalized))
            awg[key === "randomtrailers" ? "random-trailers" : "disable-cookies"] = true;
          else if (/^(0|false|no|off)$/.test(normalized))
            awg[key === "randomtrailers" ? "random-trailers" : "disable-cookies"] = false;
          else invalidAwgBoolean = true;
        }
      } else if (section === "peer") {
        if (key === "publickey") out["public-key"] = val;
        else if (key === "presharedkey") out["pre-shared-key"] = val;
        else if (key === "allowedips") out["allowed-ips"] = list();
        else if (key === "endpoint") {
          const m = val.match(/^(.*):(\d+)$/);
          if (m) {
            out.server = m[1].trim().replace(/^\[|\]$/g, "");
            out.port = parseInt(m[2], 10);
          }
        } else if (key === "reserved") {
          const nums = list()
            .map((s) => parseInt(s, 10))
            .filter((n) => !isNaN(n));
          if (nums.length === 3) out.reserved = nums;
        }
      }
    });
  if (invalidAwgBoolean) return null;
  if (
    [
      "header-protection-key",
      "content-padding-addition",
      "rekey-after-time",
      "rekey-timeout",
      "reject-after-time",
      "keepalive-timeout",
      "max-handshake-attempts",
      "random-trailers",
      "disable-cookies",
    ].some((key) => Object.prototype.hasOwnProperty.call(awg, key))
  )
    awg.version = 3;
  if (Object.keys(awg).length) out["amnezia-wg-option"] = awg;
  if (!out["private-key"] || !out["public-key"] || !out.server || !out.port) return null;
  if (!out["allowed-ips"]) out["allowed-ips"] = ["0.0.0.0/0", "::/0"];
  return out;
}
function localProfileText(proxy, groupName) {
  return JSON.stringify({
    proxies: [proxy],
    "proxy-groups": [{ name: groupName, type: "select", proxies: [proxy.name] }],
    rules: ["MATCH," + groupName],
  });
}
function readLocalProxy(id) {
  try {
    const j = JSON.parse(fs.readFileSync(profilePath(id), "utf8"));
    return (j.proxies && j.proxies[0]) || null;
  } catch (_) {
    return null;
  }
}
async function addLocalConfig(file) {
  const ext = (path.extname(file) || "").toLowerCase();
  const base = path.basename(file, ext);
  let proxy = null;
  if (ext === ".conf") {
    proxy = parseAmneziaConf(fs.readFileSync(file, "utf8"));
    if (!proxy)
      throw new Error(
        "В файле не хватает обязательных полей (PrivateKey, PublicKey, Endpoint) — это не похоже на конфиг WireGuard.",
      );
  } else if (ext === ".yaml" || ext === ".yml") {
    await ensureCore();
    const cfg = await bridge.getConfigFromFile(file);
    const arr = cfg && Array.isArray(cfg.proxies) ? cfg.proxies : [];
    const found = arr.find((p) => p && String(p.type || "").toLowerCase() === "wireguard");
    if (!found) throw new Error("В этом YAML нет ни одного узла с type: wireguard.");
    proxy = Object.assign({}, found);
    delete proxy.name;
  } else {
    throw new Error("Поддерживаются только .conf и .yaml/.yml");
  }
  let name = base;
  let i = 2;
  const taken = new Set(settings.subs.map((s) => s.name));
  while (taken.has(name)) name = base + " (" + i++ + ")";
  proxy = Object.assign({ name: name }, proxy);
  const id = "local_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(profilePath(id), localProfileText(proxy, "Свои конфиги"), "utf8");
  const now = Date.now();
  settings.subs.push({
    id: id,
    name: name,
    local: true,
    addedAt: now,
    updatedAt: now,
    endpoint: proxy.server + ":" + proxy.port,
  });
  saveSettings();
  return { id: id, name: name };
}
function injectRules(raw, excludeIdx) {
  excludeIdx = excludeIdx || null;
  const gkey = "proxy-groups" in raw ? "proxy-groups" : "proxyGroups" in raw ? "proxyGroups" : null;
  const groups = gkey ? raw[gkey] || [] : [];
  const pkey = "proxies" in raw ? "proxies" : "proxy" in raw ? "proxy" : null;
  const proxiesArr = pkey ? raw[pkey] || [] : [];
  const names = new Set(["DIRECT", "REJECT", "GLOBAL", "PASS"]);
  proxiesArr.forEach((p) => {
    if (p && p.name) names.add(p.name);
  });
  groups.forEach((g) => {
    if (g && g.name) names.add(g.name);
  });
  let vpnTarget = (groups[0] && groups[0].name) || "GLOBAL";
  if (vpnTarget.includes(",")) {
    const wrapped = vpnTarget;
    vpnTarget = "📌 VPN";
    let i = 2;
    while (names.has(vpnTarget)) vpnTarget = "📌 VPN (" + i++ + ")";
    groups.push({ name: vpnTarget, type: "select", proxies: [wrapped] });
    names.add(vpnTarget);
  }
  try {
    const cur = state.currentServer && names.has(state.currentServer) ? state.currentServer : "";
    const movedFrom = new Set();
    (settings.rules || []).forEach((r) => {
      if (r && r.proxy && !names.has(r.proxy)) {
        movedFrom.add(r.proxy);
        r.proxy = cur;
      }
    });
    if (movedFrom.size) {
      saveSettings();
      const dst = cur ? "«" + cleanSrvName(cur) + "»" : "выбранный сервер";
      const from = Array.from(movedFrom)
        .slice(0, 3)
        .map((n) => "«" + cleanSrvName(n) + "»")
        .join(", ");
      notify(
        "SnowVPN — правила обновлены",
        "Сервер " + from + " удалён из подписки. Правила переведены на " + dst + ".",
      );
      send("rules:changed", settings.rules);
    }
  } catch (_) {}
  const rkey = "rule" in raw ? "rule" : "rules" in raw ? "rules" : "rule";
  const rules = settings.rules || [];
  const commaAlias = new Map();
  {
    const proxyNameSet = new Set(proxiesArr.map((p) => p && p.name).filter(Boolean));
    const need = new Set();
    rules.forEach((r) => {
      if (r && r.proxy && r.proxy.includes(",") && proxyNameSet.has(r.proxy)) need.add(r.proxy);
    });
    need.forEach((origName) => {
      let alias = "📌 " + origName.replace(/,/g, " ").replace(/\s+/g, " ").trim();
      let i = 2;
      while (names.has(alias)) alias = alias + " (" + i++ + ")";
      groups.push({ name: alias, type: "select", proxies: [origName] });
      names.add(alias);
      commaAlias.set(origName, alias);
    });
  }
  const custom = rules
    .map((r, i) => ({ r: r, i: i }))
    .filter(({ r: r, i: i }) => r.enabled !== false && !(excludeIdx && excludeIdx.has(i)))
    .map(({ r: r }) => ruleLine(r, vpnTarget, names, commaAlias))
    .filter(Boolean);
  const ruTarget = settings.ruSitesVpn ? vpnTarget : "DIRECT";
  const ruPinned = [
    "GEOSITE,category-ru," + ruTarget,
    "GEOSITE,category-gov-ru," + ruTarget,
    "GEOSITE,category-media-ru," + ruTarget,
  ];
  const aiGlobal = settings.aiDns && state.routeMode === "global";
  if (aiGlobal) {
    raw[rkey] = ["MATCH," + vpnTarget];
  } else if (state.routeMode === "rule") {
    raw["find-process-mode"] = "always";
    const ipCheck = [
      "DOMAIN-SUFFIX,check-host.net," + vpnTarget,
      "DOMAIN-SUFFIX,ipwho.is," + vpnTarget,
      "DOMAIN-SUFFIX,ip-api.com," + vpnTarget,
      "DOMAIN-SUFFIX,ipapi.co," + vpnTarget,
    ];
    raw[rkey] = ipCheck.concat(ruPinned, custom, ["MATCH,DIRECT"]);
  } else {
    raw[rkey] = custom.concat(raw[rkey] || []);
  }
  return raw;
}
const AI_DOMAINS = [
  "gemini.google.com",
  "aistudio.google.com",
  "generativelanguage.googleapis.com",
  "alkalimakersuite-pa.clients6.google.com",
  "labs.google",
  "aisandbox-pa.googleapis.com",
  "accounts.google.com",
  "oauth2.googleapis.com",
  "www.gstatic.com",
  "gemini.gstatic.com",
  "fonts.gstatic.com",
  "lh3.googleusercontent.com",
  "clients2.googleusercontent.com",
  "ogads-pa.clients6.google.com",
  "signaler-pa.clients6.google.com",
  "waa-pa.clients6.google.com",
  "bard.google.com",
  "ai.google.dev",
  "assistant.google.com",
  "robinfrontend-pa.googleapis.com",
  "robinhood-pa.googleapis.com",
  "assistantsdk-pa.googleapis.com",
  "bard-pa.googleapis.com",
  "geminigenerativeapis.googleapis.com",
];
const AI_GATEWAY_DOMAINS = [
  "gemini.google.com",
  "aistudio.google.com",
  "generativelanguage.googleapis.com",
  "alkalimakersuite-pa.clients6.google.com",
  "labs.google",
  "aisandbox-pa.googleapis.com",
  "ai.google.dev",
  "robinfrontend-pa.googleapis.com",
];
const AI_DNS_REGIONS = {
  RU: {
    doh: "https://geohide.ru/dns-query",
    bootstrap: [
      "159.194.200.33",
      "193.233.112.67",
      "193.233.112.88",
      "37.230.192.51",
      "46.8.158.6",
      "193.233.112.68",
    ],
  },
  EU: {
    doh: "https://eu.geohide.ru/dns-query",
    bootstrap: ["5.175.161.3", "5.175.161.40", "45.13.237.213", "31.25.239.132", "143.20.64.192"],
  },
  US: {
    doh: "https://us.geohide.ru/dns-query",
    bootstrap: ["192.255.159.240", "192.255.159.241", "192.3.233.253", "107.175.76.134"],
  },
};
function aiDnsRegionConfig() {
  return AI_DNS_REGIONS[settings.aiDnsRegion] || AI_DNS_REGIONS.RU;
}
function injectAiDns(raw) {
  if (!settings.aiDns) return raw;
  const region = aiDnsRegionConfig();
  const dns = raw.dns && typeof raw.dns === "object" ? raw.dns : {};
  dns.enable = true;
  const np = Object.assign({}, dns["nameserver-policy"] || dns.nameserverPolicy || {});
  AI_DOMAINS.forEach((d) => {
    np[d] = [region.doh];
    np["+." + d] = [region.doh];
  });
  dns["nameserver-policy"] = np;
  raw.dns = dns;
  if (raw.hosts && typeof raw.hosts === "object") {
    const hosts = Object.assign({}, raw.hosts);
    delete hosts["xbox-dns.ru"];
    if (Object.keys(hosts).length) raw.hosts = hosts;
    else delete raw.hosts;
  }
  const rkey = "rule" in raw ? "rule" : "rules" in raw ? "rules" : "rule";
  const direct = [];
  AI_DOMAINS.forEach((d) => {
    direct.push("DOMAIN," + d + ",DIRECT");
    direct.push("DOMAIN-SUFFIX," + d + ",DIRECT");
  });
  raw[rkey] = direct.concat(raw[rkey] || []);
  return raw;
}
const DNS_PRESETS = {
  cloudflare: ["https://1.1.1.1/dns-query", "https://1.0.0.1/dns-query"],
  google: ["https://8.8.8.8/dns-query", "https://8.8.4.4/dns-query"],
  adguard: ["https://94.140.14.14/dns-query", "https://94.140.15.15/dns-query"],
  quad9: ["https://9.9.9.9/dns-query", "https://149.112.112.112/dns-query"],
};
const DNS_FALLBACK = [
  "https://1.1.1.1/dns-query",
  "https://8.8.8.8/dns-query",
  "https://94.140.14.14/dns-query",
];
const YANDEX_DOH = "https://common.dot.dns.yandex.net/dns-query";
const YANDEX_DNS = ["77.88.8.8", "77.88.8.1"];
function isPlainDns(s) {
  return !/^https?:\/\//i.test(String(s || ""));
}
function normDoh(s) {
  s = String(s || "").trim();
  if (!s) return null;
  if (s.includes(":853") || /^tls:\/\//i.test(s) || /^quic:\/\//i.test(s)) return null;
  const plain = s.match(/^(?:udp|plain|dns):\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/i);
  if (plain) return plain[2] && plain[2] !== "53" ? plain[1] + ":" + plain[2] : plain[1];
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "https://" + s + "/dns-query";
  if (/^[a-z0-9.-]+$/i.test(s)) return "https://" + s + "/dns-query";
  return null;
}
function dnsResolvers() {
  let user = [];
  const mode = settings.dnsMode || "auto";
  if (mode === "custom") user = Array.isArray(settings.dnsCustom) ? settings.dnsCustom : [];
  else if (mode !== "auto" && DNS_PRESETS[mode]) user = DNS_PRESETS[mode];
  user = user.map(normDoh).filter(Boolean);
  const fb = settings.ruOptimization ? [YANDEX_DOH].concat(DNS_FALLBACK) : DNS_FALLBACK;
  const merged = user.concat(fb);
  return merged.filter((v, i) => merged.indexOf(v) === i);
}
function injectSniffer(raw) {
  const base = raw.sniffer && typeof raw.sniffer === "object" ? raw.sniffer : {};
  base["override-destination"] = false;
  if (base.sniff && base.sniff.TLS && typeof base.sniff.TLS === "object")
    base.sniff.TLS["override-destination"] = false;
  if (base.sniff && base.sniff.QUIC && typeof base.sniff.QUIC === "object")
    base.sniff.QUIC["override-destination"] = false;
  raw.sniffer = base;
  if (settings.aiDns) {
    raw.sniffer = Object.assign({}, raw.sniffer, {
      enable: true,
      "override-destination": false,
      "parse-pure-ip": true,
      "override-destination-for": AI_GATEWAY_DOMAINS.map((d) => "+." + d),
      sniff: {
        HTTP: { ports: ["80", "8080-8880"], "override-destination": false },
        TLS: { ports: ["443", "8443"], "override-destination": false },
        QUIC: { ports: ["443", "8443"], "override-destination": false },
      },
    });
    return raw;
  }
  if (!settings.ruOptimization) return raw;
  raw.sniffer = Object.assign({}, raw.sniffer, {
    enable: true,
    "override-destination": false,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    sniff: {
      HTTP: { ports: ["80", "8080-8880"], "override-destination": true },
      TLS: { ports: ["443", "8443"], "override-destination": false },
      QUIC: { ports: ["443", "8443"], "override-destination": false },
    },
  });
  return raw;
}
function injectDns(raw) {
  const dns = raw.dns && typeof raw.dns === "object" ? raw.dns : {};
  dns.enable = true;
  if (settings.aiDns) {
    const policy =
      dns["nameserver-policy"] && typeof dns["nameserver-policy"] === "object"
        ? dns["nameserver-policy"]
        : {};
    const doh = [
      "https://1.1.1.1/dns-query",
      "https://8.8.8.8/dns-query",
      "https://94.140.14.14/dns-query",
    ];
    const aiRegion = aiDnsRegionConfig();
    raw.dns = {
      enable: true,
      ipv6: true,
      "use-hosts": true,
      "use-system-hosts": true,
      "respect-rules": false,
      "default-nameserver": aiRegion.bootstrap,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "fake-ip-filter": AI_DOMAINS.concat(
        AI_DOMAINS.map((d) => "*." + d),
        [
          "*.lan",
          "localhost.ptlogin2.qq.com",
          "*.ru",
          "*.yandex.ru",
          "ya.ru",
          "*.google.com",
          "mail.google.com",
          "*.instagram.com",
          "*.facebook.com",
          "*.youtube.com",
          "*.vk.com",
        ],
      ),
      nameserver: doh,
      fallback: doh,
      "proxy-server-nameserver": doh,
      "nameserver-policy": policy,
      "fallback-filter": {
        geoip: false,
        "geoip-code": "CN",
        geosite: ["gfw"],
        ipcidr: [],
        domain: [],
      },
    };
    return raw;
  }
  if (settings.ruOptimization) dns.ipv6 = false;
  dns["enhanced-mode"] = "redir-host";
  const res = dnsResolvers();
  const resDoh = res.filter((s) => !isPlainDns(s));
  dns["proxy-server-nameserver"] = resDoh.length ? resDoh : DNS_FALLBACK;
  if ((settings.dnsMode || "auto") !== "auto") dns.nameserver = res;
  else if (!Array.isArray(dns.nameserver) || !dns.nameserver.length) dns.nameserver = res;
  const boot = (settings.ruOptimization ? YANDEX_DNS : []).concat(
    Array.isArray(dns["default-nameserver"]) ? dns["default-nameserver"] : [],
    ["8.8.8.8", "1.1.1.1"],
    settings.ruOptimization ? [] : YANDEX_DNS,
  );
  dns["default-nameserver"] = boot.filter((v, i) => boot.indexOf(v) === i);
  raw.dns = dns;
  return raw;
}
function injectRealityCompat(cfg) {
  for (const p of cfg && Array.isArray(cfg.proxies) ? cfg.proxies : []) {
    if (!p || !p["reality-opts"] || typeof p["reality-opts"] !== "object") continue;
    p["reality-opts"]["support-x25519mlkem768"] = true;
    p["client-fingerprint"] = "chrome";
  }
  return cfg;
}
async function applyActive() {
  const id = state.activeSub;
  if (!id || !fs.existsSync(profilePath(id))) {
    state.hasProfile = false;
    return false;
  }
  await ensureCore();
  let rawConfig = await bridge.getConfigFromFile(profilePath(id));
  try {
    const pt = {};
    (Array.isArray(rawConfig.proxies) ? rawConfig.proxies : []).forEach((p) => {
      if (p && p.name) pt[p.name] = p.network || "";
    });
    proxyTransport = pt;
  } catch (_) {}
  try {
    buildNodeAddrs(rawConfig);
  } catch (_) {}
  try {
    rawConfig = injectRealityCompat(rawConfig);
  } catch (e) {
    console.log("injectRealityCompat", e.message);
  }
  try {
    rawConfig = injectTun(rawConfig);
  } catch (e) {
    console.log("injectTun", e.message);
  }
  try {
    rawConfig = injectSniffer(rawConfig);
  } catch (e) {
    console.log("injectSniffer", e.message);
  }
  try {
    rawConfig = injectRules(rawConfig);
  } catch (e) {
    console.log("injectRules", e.message);
  }
  try {
    rawConfig = injectAiDns(rawConfig);
  } catch (e) {
    console.log("injectAiDns", e.message);
  }
  try {
    rawConfig = injectDns(rawConfig);
  } catch (e) {
    console.log("injectDns", e.message);
  }
  try {
    const dumpConfig = Object.assign({}, rawConfig, {
      tun: Object.assign({}, rawConfig.tun, { enable: state.netMode === "tun" }),
    });
    fs.writeFileSync(path.join(HOME_DIR, "last-config.json"), JSON.stringify(dumpConfig, null, 2));
  } catch (_) {}
  try {
    await bridge.setupConfig(rawConfig, settings.selected || {});
  } catch (e) {
    diag("setupConfig FAILED (" + e.message + "), isolating broken rule");
    const buildCandidate = async (excludeIdx) => {
      let cfg = await bridge.getConfigFromFile(profilePath(id));
      buildNodeAddrs(cfg);
      cfg = injectRealityCompat(cfg);
      cfg = injectTun(cfg);
      cfg = injectSniffer(cfg);
      cfg = injectRules(cfg, excludeIdx);
      cfg = injectAiDns(cfg);
      cfg = injectDns(cfg);
      return cfg;
    };
    const rules = settings.rules || [];
    const badSet = new Set();
    const candidates = () =>
      rules.map((_, i) => i).filter((i) => rules[i].enabled !== false && !badSet.has(i));
    let finalCfg = null,
      solved = false;
    for (let round = 0; round < 8 && candidates().length; round++) {
      const testCfg = await buildCandidate(badSet);
      const err = await bridge.validateConfig(JSON.stringify(testCfg));
      if (!err) {
        finalCfg = testCfg;
        solved = true;
        break;
      }
      let found = -1;
      for (const idx of candidates()) {
        const tryExclude = new Set(badSet);
        tryExclude.add(idx);
        const tryCfg = await buildCandidate(tryExclude);
        const err2 = await bridge.validateConfig(JSON.stringify(tryCfg));
        if (!err2) {
          found = idx;
          break;
        }
      }
      if (found === -1) break;
      badSet.add(found);
    }
    if (solved && finalCfg) {
      await bridge.setupConfig(finalCfg, settings.selected || {});
      const names = [];
      badSet.forEach((idx) => {
        const r = rules[idx];
        if (r) {
          r.enabled = false;
          r.invalid = true;
          names.push(r.name || r.value || "правило #" + (idx + 1));
        }
      });
      saveSettings();
      send("rule:invalid", { names: names, rules: settings.rules });
      notify(
        "SnowVPN — найдено невалидное правило",
        "Отключено: " + names.join(", ") + ". Проверьте раздел «Правила».",
      );
    } else {
      diag("could not isolate a single broken rule, falling back to no custom rules");
      let fallback = null,
        recovered = false;
      try {
        fallback = await buildCandidate(new Set(rules.map((_, i) => i)));
        await bridge.setupConfig(fallback, settings.selected || {});
        recovered = true;
      } catch (_) {}
      if (recovered) {
        send("rule:invalid", { names: null, rules: settings.rules });
        notify(
          "SnowVPN — правила отключены",
          "Не удалось определить конкретное некорректное правило — временно отключены все. Проверьте раздел «Правила».",
        );
      } else {
        throw e;
      }
    }
  }
  const coreRouteMode = settings.aiDns && state.routeMode === "global" ? "rule" : state.routeMode;
  await bridge.updateConfig({
    "mixed-port": MIXED_PORT,
    mode: coreRouteMode,
    "allow-lan": !!settings.allowLan,
    "external-controller": "",
    "unified-delay": true,
    "tcp-concurrent": true,
  });
  if (state.running) {
    await bridge.updateConfig({ tun: tunSchema(state.netMode === "tun") });
    await bridge.startListener();
  }
  state.hasProfile = true;
  return true;
}
let _opQueue = Promise.resolve();
function serializeOp(fn) {
  const run = _opQueue.then(fn, fn);
  _opQueue = run.catch(() => {});
  return run;
}
function connect() {
  return serializeOp(connectImpl);
}
function disconnect() {
  return serializeOp(disconnectImpl);
}
async function connectImpl() {
  userDisconnected = false;
  state.status = "connecting";
  send("vpn:state", state);
  await ensureCore();
  if (!state.activeSub) throw new Error("Сначала добавьте подписку");
  if (state.netMode === "tun" && !isAdmin()) {
    const e = new Error("TUN требует прав администратора");
    e.needAdmin = true;
    throw e;
  }
  const ok = await applyActive();
  if (!ok) throw new Error("Нет профиля/подписки");
  if (!bridge || !bridge.isAlive())
    throw new Error("Ядро перезапустилось — попробуйте подключиться ещё раз");
  if (state.netMode === "tun") {
    await setSystemProxy(false);
    diag(`connect: tun up, device=${TUN_DEVICE}`);
    await bridge.updateConfig({ tun: tunSchema(true) });
    await bridge.startListener();
    killSwitch.forceTunPrivate(TUN_DEVICE).catch(() => {});
  } else {
    await bridge.updateConfig({ tun: tunSchema(false) });
    await bridge.startListener();
    await setSystemProxy(true, PROXY_HOSTPORT);
  }
  if (!state.connectedAt) state.connectedAt = Date.now();
  state.running = true;
  state.status = "connected";
  reconnectAttempts = 0;
  send("vpn:state", state);
  if (settings.killSwitch) {
    serializeOp(async () => {
      if (!state.running || !settings.killSwitch) return;
      settings.ksActive = true;
      saveSettings();
      const r = await killSwitch.engage(CORE_EXE, process.execPath, TUN_DEVICE);
      diag("killswitch engage: " + JSON.stringify(r));
      if (!r.ok) {
        settings.ksActive = false;
        saveSettings();
        if (!/отменено/.test(r.error || ""))
          notify("SnowVPN — Kill Switch не включился", r.error || "Нужны права администратора");
      } else if (r.fwOff)
        notify(
          "SnowVPN — Kill Switch",
          "Брандмауэр Windows выключен — защита от утечек не действует",
        );
    }).catch(() => {});
  }
  notify(
    "SnowVPN — подключено",
    state.currentServer ? cleanSrvName(state.currentServer) : "Трафик идёт через VPN",
  );
  getProxyGroups()
    .then((g) => {
      lastGroups = g;
      refreshTray();
      prefetchFlags(g).then(refreshTray);
    })
    .catch(() => {});
  return state;
}
async function disconnectImpl() {
  const was = state.running;
  userDisconnected = true;
  clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  if (was) {
    state.status = "disconnecting";
    send("vpn:state", state);
  }
  try {
    await ksCleanup();
  } catch (_) {}
  if (bridge) {
    try {
      if (state.netMode === "tun") await bridge.stopTun();
    } catch (_) {}
    try {
      await bridge.stopListener();
    } catch (_) {}
  }
  try {
    await setSystemProxy(false);
  } catch (_) {}
  state.running = false;
  state.status = "disconnected";
  state.connectedAt = null;
  send("vpn:state", state);
  try {
    saveSettings();
  } catch (_) {}
  if (was) notify("SnowVPN — отключено", "VPN выключен");
  return state;
}
let userDisconnected = false,
  reconnectTimer = null,
  reconnectAttempts = 0;
function scheduleReconnect() {
  if (settings.autoReconnect === false || isQuitting || userDisconnected) {
    state.status = "disconnected";
    send("vpn:state", state);
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  const delay = Math.min(2e3 * reconnectAttempts, 15e3);
  state.status = "reconnecting";
  send("vpn:state", state);
  diag("auto-reconnect attempt " + reconnectAttempts + " in " + delay + "ms");
  reconnectTimer = setTimeout(async () => {
    if (isQuitting || userDisconnected) return;
    try {
      await connect();
      reconnectAttempts = 0;
    } catch (e) {
      scheduleReconnect();
    }
  }, delay);
}
const LIVENESS_URLS = [
  "http://www.gstatic.com/generate_204",
  "http://cp.cloudflare.com/generate_204",
  "http://www.msftconnecttest.com/connecttest.txt",
];
function probeUrl(url, timeout = 6e3) {
  return new Promise((res) => {
    let done = false,
      req = null,
      t = null;
    const fin = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try {
        if (req) req.abort();
      } catch (_) {}
      res(v);
    };
    try {
      req = net.request(url);
      req.on("response", () => fin(true));
      req.on("error", () => fin(false));
      req.end();
      t = setTimeout(() => fin(false), timeout);
    } catch (_) {
      fin(false);
    }
  });
}
async function checkConnectivity() {
  for (const u of LIVENESS_URLS) {
    if (await probeUrl(u)) return true;
  }
  return false;
}
let subAutoTimer = null;
const DEFAULT_SUB_INTERVAL_H = 12;
const PROFILE_FORMAT = 1;
const APP_STARTED_AT = Date.now();
async function rebuildProfilesOnce() {
  if ((settings.profileFormat || 0) >= PROFILE_FORMAT) return 0;
  let updated = 0,
    allOk = true;
  for (const s of settings.subs || []) {
    if (s.local || (s.updatedAt || 0) >= APP_STARTED_AT) continue;
    try {
      await updateSub(s.id);
      updated++;
    } catch (_) {
      allOk = false;
    }
  }
  if (allOk) {
    settings.profileFormat = PROFILE_FORMAT;
    saveSettings();
  }
  diag(
    "rebuildProfilesOnce: перекачано " +
      updated +
      (allOk ? "" : ", не все — повтор при следующем запуске"),
  );
  return updated;
}
function startSubAutoUpdate() {
  clearInterval(subAutoTimer);
  const tick = async () => {
    if (settings.autoUpdateSubs === false) return;
    const now = Date.now();
    for (const s of settings.subs || []) {
      const hours = s.interval > 0 ? s.interval : DEFAULT_SUB_INTERVAL_H;
      if (now - (s.updatedAt || 0) < hours * 36e5) continue;
      try {
        await updateSub(s.id);
        diag("sub auto-updated: " + s.id);
        if (state.activeSub === s.id) send("sub:changed");
      } catch (_) {}
    }
  };
  subAutoTimer = setInterval(tick, 30 * 6e4);
  setTimeout(tick, 6e4);
}
let liveTimer = null,
  liveFails = 0,
  liveReconnects = 0,
  livePausedUntil = 0;
const LIVENESS_INTERVAL_MS = 25e3;
const RECONNECT_AFTER_FAILS = 5;
function startLiveness() {
  clearInterval(liveTimer);
  liveTimer = setInterval(async () => {
    if (!state.running || state.status !== "connected" || settings.autoReconnect === false) {
      liveFails = 0;
      return;
    }
    if (Date.now() < livePausedUntil) return;
    const ok = await checkConnectivity();
    if (ok) {
      liveFails = 0;
      liveReconnects = 0;
      return;
    }
    if (++liveFails >= RECONNECT_AFTER_FAILS) {
      liveFails = 0;
      if (++liveReconnects > 5) {
        liveReconnects = 0;
        livePausedUntil = Date.now() + 10 * 60 * 1e3;
        diag("liveness: 5 reconnects did not help -> pause auto-reconnect for 10m");
        notify(
          "SnowVPN — соединение нестабильно",
          "Переподключение не помогает. Попробуйте выбрать другой сервер или переключить режим (TUN / Прокси).",
        );
        return;
      }
      diag("liveness fail -> reconnect #" + liveReconnects);
      userDisconnected = false;
      try {
        await connect();
      } catch (_) {
        scheduleReconnect();
      }
    }
  }, LIVENESS_INTERVAL_MS);
}
function cleanSrvName(n) {
  return String(n || "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .trim();
}
function notify(title, body) {
  try {
    const { Notification: Notification } = require("electron");
    if (Notification.isSupported())
      new Notification({
        title: title,
        body: body,
        icon: fs.existsSync(ICON) ? ICON : undefined,
      }).show();
  } catch (_) {}
}
function parseUserInfo(header) {
  if (!header) return null;
  const out = {};
  header.split(";").forEach((kv) => {
    const [k, v] = kv.split("=");
    if (k && v !== undefined) out[k.trim()] = Number(v.trim());
  });
  return {
    used: (out.upload || 0) + (out.download || 0),
    total: out.total || 0,
    expire: out.expire || 0,
  };
}
function decodeProfileTitle(h) {
  if (!h) return "";
  h = Array.isArray(h) ? h[0] : h;
  h = String(h).trim();
  const m = /^base64:(.*)$/i.exec(h);
  try {
    return m ? Buffer.from(m[1], "base64").toString("utf8").trim() : h;
  } catch (_) {
    return h;
  }
}
function parseDispositionName(h) {
  if (!h) return "";
  h = Array.isArray(h) ? h[0] : h;
  let m = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(h);
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/^"|"$/g, "")).trim();
    } catch (_) {
      return m[1].replace(/^"|"$/g, "").trim();
    }
  }
  m = /filename="?([^";]+)"?/i.exec(h);
  return m ? m[1].trim() : "";
}
function fetchSub(url, uaOverride) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url: url, redirect: "follow", cache: "no-store" });
    let finished = false;
    const finish = (fn, v) => {
      if (finished) return;
      finished = true;
      clearTimeout(tmr);
      fn(v);
    };
    const tmr = setTimeout(() => {
      try {
        req.abort();
      } catch (_) {}
      finish(reject, new Error("Таймаут запроса к серверу подписки"));
    }, 3e4);
    const chunks = [];
    let userinfo = null;
    let status = 0;
    let title = "";
    req.on("response", (res) => {
      status = res.statusCode || 0;
      const h = res.headers["subscription-userinfo"];
      if (h) userinfo = parseUserInfo(Array.isArray(h) ? h[0] : h);
      title =
        decodeProfileTitle(res.headers["profile-title"]) ||
        parseDispositionName(res.headers["content-disposition"]) ||
        "";
      let iv = res.headers["profile-update-interval"];
      iv = Array.isArray(iv) ? iv[0] : iv;
      const interval = iv ? Math.max(1, parseInt(iv, 10) || 0) : 0;
      let su = res.headers["support-url"];
      su = Array.isArray(su) ? su[0] : su;
      const support = (su || "").trim();
      let an = res.headers["announce"];
      an = Array.isArray(an) ? an[0] : an;
      let hl = res.headers["x-hwid-limit"];
      hl = Array.isArray(hl) ? hl[0] : hl;
      const hwidLimit =
        String(hl || "")
          .trim()
          .toLowerCase() === "true";
      let received = 0;
      const MAX_SUB_BYTES = 10 * 1024 * 1024;
      res.on("data", (c) => {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
        received += buf.length;
        if (received > MAX_SUB_BYTES) {
          try {
            req.abort();
          } catch (_) {}
          finish(reject, new Error("Сервер подписки вернул слишком много данных"));
          return;
        }
        chunks.push(buf);
      });
      res.on("end", () =>
        finish(resolve, {
          text: Buffer.concat(chunks).toString("utf8"),
          userinfo: userinfo,
          status: status,
          title: title,
          interval: interval,
          support: support,
          announce: an || "",
          hwidLimit: hwidLimit,
        }),
      );
      res.on("error", (e) => finish(reject, e));
    });
    req.on("error", (e) => finish(reject, e));
    req.setHeader(
      "User-Agent",
      uaOverride || (settings && settings.devUserAgent ? settings.devUserAgent : SUB_UA),
    );
    req.setHeader("Accept", "*/*");
    req.setHeader("x-hwid", getHWID());
    req.setHeader("x-device-os", "Windows");
    req.setHeader("x-ver-os", os.release());
    req.setHeader("x-device-model", "PC");
    req.end();
  });
}
const EXTRA_NODES_UA = "v2rayNG/1.8.5";
const WL_NAME_RE = /(^|[^a-zA-Zа-яёА-ЯЁ])WL(?=[^a-zA-Zа-яёА-ЯЁ]|$)/;
function parseVlessLink(line) {
  try {
    if (!/^vless:\/\//i.test(line)) return null;
    const u = new URL(line);
    const uuid = decodeURIComponent(u.username || "");
    const server = u.hostname;
    const port = Number(u.port);
    if (!uuid || !server || !port) return null;
    const q = u.searchParams;
    let name = "";
    try {
      name = decodeURIComponent(u.hash.replace(/^#/, "")).trim();
    } catch (_) {
      name = "";
    }
    if (!name) name = server + ":" + port;
    if (WL_NAME_RE.test(name)) return null;
    const net_ = (q.get("type") || "tcp").toLowerCase();
    const sec = (q.get("security") || "none").toLowerCase();
    const proxy = {
      name: name,
      type: "vless",
      server: server,
      port: port,
      uuid: uuid,
      udp: true,
      "packet-encoding": q.get("packetEncoding") || "xudp",
    };
    const flow = q.get("flow");
    if (flow) proxy.flow = flow;
    if (net_ && net_ !== "tcp") proxy.network = net_;
    if (sec === "reality") {
      const pbk = q.get("pbk");
      if (!pbk) return null;
      proxy.tls = true;
      proxy.servername = q.get("sni") || server;
      proxy["client-fingerprint"] = q.get("fp") || "chrome";
      proxy["reality-opts"] = { "public-key": pbk, "short-id": q.get("sid") || "" };
    } else if (sec === "tls") {
      proxy.tls = true;
      proxy.servername = q.get("sni") || q.get("host") || server;
      proxy["client-fingerprint"] = q.get("fp") || "chrome";
    }
    if (net_ === "xhttp") {
      let extra = null;
      const ex = q.get("extra");
      if (ex) {
        try {
          extra = JSON.parse(ex);
        } catch (_) {
          extra = null;
        }
      }
      const xo = (proxy["xhttp-opts"] = {
        path: q.get("path") || "/",
        mode: q.get("mode") || "auto",
        "no-grpc-header": !!(extra && extra.noGRPCHeader),
      });
      const host = q.get("host");
      if (host) xo.host = host;
      if (extra && typeof extra === "object") {
        const str = (v) =>
          typeof v === "string" && v !== ""
            ? v
            : typeof v === "number"
              ? String(Math.trunc(v))
              : null;
        if (str(extra.xPaddingBytes)) xo["x-padding-bytes"] = str(extra.xPaddingBytes);
        if (typeof extra.xPaddingObfsMode === "boolean")
          xo["x-padding-obfs-mode"] = extra.xPaddingObfsMode;
        [
          ["xPaddingKey", "x-padding-key"],
          ["xPaddingHeader", "x-padding-header"],
          ["xPaddingPlacement", "x-padding-placement"],
          ["xPaddingMethod", "x-padding-method"],
          ["uplinkHttpMethod", "uplink-http-method"],
          ["sessionPlacement", "session-placement"],
          ["sessionKey", "session-key"],
          ["seqPlacement", "seq-placement"],
          ["seqKey", "seq-key"],
          ["uplinkDataPlacement", "uplink-data-placement"],
          ["uplinkDataKey", "uplink-data-key"],
        ].forEach(([src, dst]) => {
          if (typeof extra[src] === "string" && extra[src]) xo[dst] = extra[src];
        });
        if (typeof extra.uplinkChunkSize === "number")
          xo["uplink-chunk-size"] = Math.trunc(extra.uplinkChunkSize);
        if (typeof extra.scMaxEachPostBytes === "number")
          xo["sc-max-each-post-bytes"] = Math.trunc(extra.scMaxEachPostBytes);
        if (typeof extra.scMinPostsIntervalMs === "number")
          xo["sc-min-posts-interval-ms"] = Math.trunc(extra.scMinPostsIntervalMs);
        const xm = extra.xmux;
        if (xm && typeof xm === "object") {
          const reuse = {};
          [
            ["maxConnections", "max-connections"],
            ["maxConcurrency", "max-concurrency"],
            ["cMaxReuseTimes", "c-max-reuse-times"],
            ["hMaxRequestTimes", "h-max-request-times"],
            ["hMaxReusableSecs", "h-max-reusable-secs"],
          ].forEach(([src, dst]) => {
            const v = str(xm[src]);
            if (v) reuse[dst] = v;
          });
          if (typeof xm.hKeepAlivePeriod === "number")
            reuse["h-keep-alive-period"] = Math.trunc(xm.hKeepAlivePeriod);
          if (Object.keys(reuse).length) xo["reuse-settings"] = reuse;
        }
      }
    } else if (net_ === "ws") {
      proxy["ws-opts"] = { path: q.get("path") || "/" };
      const host = q.get("host");
      if (host) proxy["ws-opts"].headers = { Host: host };
    } else if (net_ === "grpc") {
      proxy["grpc-opts"] = { "grpc-service-name": q.get("serviceName") || "" };
    }
    return proxy;
  } catch (_) {
    return null;
  }
}
async function mergeExtraNodes(text, url) {
  if (!yaml) return text;
  try {
    const r = await fetchSub(url, EXTRA_NODES_UA).catch(() => null);
    if (!r || !r.text) return text;
    const raw = r.text.trim();
    let decoded = raw;
    if (!/vless:\/\//i.test(raw)) {
      try {
        decoded = Buffer.from(raw, "base64").toString("utf8");
      } catch (_) {
        decoded = raw;
      }
    }
    const lines = decoded
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const extraProxies = lines.map(parseVlessLink).filter(Boolean);
    if (!extraProxies.length) return text;
    let doc;
    try {
      doc = yaml.load(text);
    } catch (_) {
      return text;
    }
    if (!doc || typeof doc !== "object") return text;
    const pkey = "proxies" in doc ? "proxies" : "proxy" in doc ? "proxy" : "proxies";
    const gkey =
      "proxy-groups" in doc
        ? "proxy-groups"
        : "proxyGroups" in doc
          ? "proxyGroups"
          : "proxy-groups";
    if (!Array.isArray(doc[pkey])) doc[pkey] = [];
    if (!Array.isArray(doc[gkey])) doc[gkey] = [];
    const existingNames = new Set(doc[pkey].map((p) => p && p.name).filter(Boolean));
    const addedNames = [];
    for (const p of extraProxies) {
      if (existingNames.has(p.name)) continue;
      doc[pkey].push(p);
      existingNames.add(p.name);
      addedNames.push(p.name);
    }
    if (!addedNames.length) return text;
    const mainGroup =
      doc[gkey].find((g) => g && g.type === "select" && Array.isArray(g.proxies)) || doc[gkey][0];
    if (mainGroup && Array.isArray(mainGroup.proxies)) {
      addedNames.forEach((n) => {
        if (!mainGroup.proxies.includes(n)) mainGroup.proxies.push(n);
      });
    }
    diag("добрано узлов из v2ray-формата подписки: " + addedNames.length);
    return yaml.dump(doc, { lineWidth: -1 });
  } catch (e) {
    diag("mergeExtraNodes пропущен: " + e.message);
    return text;
  }
}
function hostName(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "subscription";
  }
}
function looksBlocked(text) {
  const t = (text || "").trim().slice(0, 400).toLowerCase();
  return (
    t.includes("<iframe") ||
    t.includes("<!doctype html") ||
    t.includes("<html") ||
    t.includes("403") ||
    t.includes("forbidden") ||
    t.includes("access denied")
  );
}
function looksDummy(text) {
  return /не поддерживается|скачайте.{0,20}happ|snow client|flclashx или|передачу hwid/i.test(
    text || "",
  );
}
function maybeShowHwidLimit(hwidLimit, announce, support) {
  if (!hwidLimit || !announce) return;
  let text = String(announce).trim();
  const m = /^base64:(.*)$/i.exec(text);
  try {
    text = Buffer.from(m ? m[1] : text, "base64").toString("utf8");
  } catch (_) {}
  if (text) send("hwidLimit:show", { text: text, supportUrl: support || "" });
}
const SUB_HOSTS_FALLBACK = ["sub.snowfall.top", "cdn.mainboss.net"];
const SUB_HOSTS_URL = "http://45.8.93.251/windows2/sub-hosts.json";
function subHosts() {
  const c = settings.subHostsCache;
  return Array.isArray(c) && c.length ? c : SUB_HOSTS_FALLBACK;
}
function refreshSubHosts() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    try {
      const req = net.request({ url: SUB_HOSTS_URL + "?_=" + Date.now() });
      let d = "";
      req.on("response", (res) => {
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(d);
            const list = Array.isArray(j) ? j : j.hosts;
            if (Array.isArray(list)) {
              const clean = list
                .filter((h) => typeof h === "string")
                .map((h) => h.trim().toLowerCase())
                .filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
              if (clean.length) {
                settings.subHostsCache = clean;
                saveSettings();
                diag("sub-hosts обновлены: " + clean.join(", "));
              }
            }
          } catch (_) {}
          finish();
        });
        res.on("error", finish);
      });
      req.on("error", finish);
      req.end();
      setTimeout(finish, 6e3);
    } catch (_) {
      finish();
    }
  });
}
function isOurSubUrl(u) {
  try {
    const p = new URL(String(u));
    if (!["http:", "https:"].includes(p.protocol)) return false;
    const h = p.hostname.toLowerCase();
    return subHosts().some((d) => h === d || h.endsWith("." + d));
  } catch (_) {
    return false;
  }
}
function normalizeSubUrl(u) {
  const s = String(u == null ? "" : u)
    .trim()
    .replace(/^[<"'\s]+|[>"'\s]+$/g, "");
  if (!s) return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return "https://" + s.replace(/^\/+/, "");
}
async function importSub(url, name) {
  url = normalizeSubUrl(url);
  if (!settings.devUnlocked && !isOurSubUrl(url)) {
    await refreshSubHosts();
    if (!isOurSubUrl(url)) {
      const e = new Error("Это ссылка не от SnowVPN. Клиент работает только с подписками SnowVPN.");
      e.needSub = true;
      throw e;
    }
  }
  const {
    text: text,
    userinfo: userinfo,
    status: status,
    title: title,
    interval: interval,
    support: support,
    announce: announce,
    hwidLimit: hwidLimit,
  } = await fetchSub(url);
  maybeShowHwidLimit(hwidLimit, announce, support);
  if (status && status >= 400) throw new Error(`Сервер вернул ${status}. Проверьте ссылку/доступ`);
  const skipChecks = !!(settings.devUnlocked && settings.devForce);
  if (!text || text.trim().length < 30) throw new Error("Сервер вернул пустой ответ");
  if (!skipChecks && looksBlocked(text))
    throw new Error("Сервер заблокировал запрос или ссылка неверна (403/HTML)");
  if (!skipChecks && looksDummy(text))
    throw new Error("Панель не распознала клиента по HWID. Повторите попытку");
  await ensureCore();
  const err = await bridge.validateConfig(text);
  if (err) throw new Error("Невалидный конфиг: " + String(err).slice(0, 140));
  let finalText = text;
  try {
    const enriched = await mergeExtraNodes(text, url);
    if (enriched !== text && !(await bridge.validateConfig(enriched))) finalText = enriched;
  } catch (_) {}
  const id = "sub_" + Date.now().toString(36);
  fs.writeFileSync(profilePath(id), finalText, "utf8");
  const now = Date.now();
  const auto = title || hostName(url);
  settings.subs.push({
    id: id,
    name: name || auto,
    autoName: auto,
    url: url,
    addedAt: now,
    updatedAt: now,
    userinfo: userinfo,
    interval: interval || 0,
    supportUrl: support || "",
  });
  settings.activeSub = id;
  state.activeSub = id;
  saveSettings();
  state.hasProfile = false;
  await applyActive();
  return id;
}
function extractDeepLinkUrl(argv) {
  const raw = (argv || []).find(
    (a) => typeof a === "string" && a.toLowerCase().startsWith(DEEPLINK_PROTOCOL + "://"),
  );
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase();
    if (!["install-config", "add", "import"].includes(host)) return null;
    const sub = u.searchParams.get("url");
    return sub ? sub : null;
  } catch (_) {
    return null;
  }
}
async function handleDeepLinkArgv(argv) {
  const subUrl = extractDeepLinkUrl(argv);
  if (!subUrl) return;
  try {
    try {
      showWindow();
    } catch (_) {}
    const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : null, {
      type: "question",
      noLink: true,
      defaultId: 0,
      cancelId: 1,
      buttons: ["Добавить", "Отмена"],
      title: "Добавление подписки",
      message: "Добавить подписку с " + hostName(subUrl) + "?",
      detail:
        "Ссылка открыта из браузера. Она станет активной подпиской — добавляйте только если это ваш личный кабинет SnowVPN.",
    });
    if (r.response !== 0) return;
  } catch (_) {}
  try {
    const id = await importSub(subUrl);
    const s = subById(id);
    send("deeplink:added", (s && s.name) || "Подписка");
    send("sub:changed");
  } catch (e) {
    send("deeplink:error", e.message || "Не удалось добавить подписку");
  }
}
async function updateSub(id) {
  const s = subById(id);
  if (!s) throw new Error("Подписка не найдена");
  if (s.local)
    throw new Error(
      "Это локальный файл, не подписка по ссылке — обновлять по сети нечего. Чтобы поменять точку входа, нажмите карандаш.",
    );
  const {
    text: text,
    userinfo: userinfo,
    status: status,
    title: title,
    interval: interval,
    support: support,
    announce: announce,
    hwidLimit: hwidLimit,
  } = await fetchSub(s.url);
  maybeShowHwidLimit(hwidLimit, announce, support);
  if (status && status >= 400) throw new Error(`Сервер вернул ${status}`);
  if (!text || text.trim().length < 30 || looksBlocked(text))
    throw new Error("Сервер заблокировал запрос (403/HTML)");
  await ensureCore();
  const err = await bridge.validateConfig(text);
  if (err) throw new Error("Невалидный конфиг");
  let finalText = text;
  try {
    const enriched = await mergeExtraNodes(text, s.url);
    if (enriched !== text && !(await bridge.validateConfig(enriched))) finalText = enriched;
  } catch (_) {}
  fs.writeFileSync(profilePath(id), finalText, "utf8");
  s.updatedAt = Date.now();
  if (userinfo) s.userinfo = userinfo;
  if (title && (!s.name || s.name === s.autoName || s.name === hostName(s.url))) s.name = title;
  if (title) s.autoName = title;
  if (interval) s.interval = interval;
  if (support) s.supportUrl = support;
  saveSettings();
  checkSubExpiry(s);
  if (state.activeSub === id) {
    state.hasProfile = false;
    await applyActive();
  }
  return true;
}
async function editSub(id, patch) {
  const s = subById(id);
  if (!s) throw new Error("Подписка не найдена");
  patch = patch || {};
  if (s.local) {
    const ep = (patch.endpoint || "").trim();
    if (ep) {
      const m = ep.match(/^(.*):(\d+)$/);
      if (!m) throw new Error("Нужен адрес в виде хост:порт, например 8.47.69.73:2408");
      const port = parseInt(m[2], 10);
      if (!(port > 0 && port < 65536)) throw new Error("Порт должен быть числом от 1 до 65535");
      const proxy = readLocalProxy(id);
      if (!proxy) throw new Error("Не удалось прочитать сохранённый конфиг");
      proxy.server = m[1].trim().replace(/^\[|\]$/g, "");
      proxy.port = port;
      fs.writeFileSync(profilePath(id), localProfileText(proxy, "Свои конфиги"), "utf8");
      s.endpoint = ep;
      s.updatedAt = Date.now();
      if (state.activeSub === id) {
        state.hasProfile = false;
        await applyActive();
      }
    }
    if (patch.name !== undefined) {
      const n = String(patch.name).trim();
      if (n) s.name = n;
    }
    saveSettings();
    return true;
  }
  const newUrl = (patch.url || "").trim();
  if (newUrl && newUrl !== s.url) {
    const { text: text, userinfo: userinfo, status: status, title: title } = await fetchSub(newUrl);
    if (status && status >= 400) throw new Error(`Сервер вернул ${status}`);
    if (!text || text.trim().length < 30 || looksBlocked(text))
      throw new Error("Ссылка неверна (403/HTML)");
    await ensureCore();
    const err = await bridge.validateConfig(text);
    if (err) throw new Error("Невалидный конфиг: " + String(err).slice(0, 140));
    let finalText = text;
    try {
      const enriched = await mergeExtraNodes(text, newUrl);
      if (enriched !== text && !(await bridge.validateConfig(enriched))) finalText = enriched;
    } catch (_) {}
    fs.writeFileSync(profilePath(id), finalText, "utf8");
    s.url = newUrl;
    s.updatedAt = Date.now();
    if (userinfo) s.userinfo = userinfo;
    if (title) {
      s.autoName = title;
      if (patch.name === undefined) s.name = title;
    }
    if (state.activeSub === id) {
      state.hasProfile = false;
      await applyActive();
    }
  }
  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (n) s.name = n;
  }
  saveSettings();
  return true;
}
function checkSubExpiry(s) {
  try {
    const exp = s && s.userinfo && s.userinfo.expire;
    if (!exp) return;
    const daysLeft = Math.floor((exp * 1e3 - Date.now()) / 864e5);
    if (daysLeft < 0 || daysLeft > 3) return;
    settings.expireNotified = settings.expireNotified || {};
    if (settings.expireNotified[s.id] === todayKey()) return;
    settings.expireNotified[s.id] = todayKey();
    saveSettings();
    const when =
      daysLeft === 0 ? "сегодня" : daysLeft === 1 ? "завтра" : "через " + daysLeft + " дня";
    notify(
      "SnowVPN — подписка истекает " + when,
      "«" + (s.name || "Подписка") + "» — продлите, чтобы не остаться без VPN",
    );
  } catch (_) {}
}
async function removeSub(id) {
  if (state.activeSub === id && state.running) await disconnect();
  try {
    fs.unlinkSync(profilePath(id));
  } catch (_) {}
  settings.subs = settings.subs.filter((s) => s.id !== id);
  if (state.activeSub === id) {
    state.activeSub = settings.subs[0] ? settings.subs[0].id : null;
    settings.activeSub = state.activeSub;
    state.hasProfile = false;
  }
  saveSettings({ allowShrink: true });
  if (state.activeSub) await applyActive();
  return true;
}
async function setActive(id) {
  if (!subById(id)) return false;
  return serializeOp(async () => {
    const wasRunning = state.running;
    if (wasRunning) await disconnectImpl();
    state.activeSub = id;
    settings.activeSub = id;
    saveSettings();
    state.hasProfile = false;
    if (wasRunning) await connectImpl();
    else await applyActive();
    return true;
  });
}
async function getProxyGroups() {
  if (!state.activeSub) return [];
  await ensureCore();
  if (!state.hasProfile) await applyActive();
  const raw = await bridge.getProxies();
  const proxies = raw && raw.proxies ? raw.proxies : raw;
  if (!proxies || typeof proxies !== "object") return [];
  const GROUP_TYPES = ["Selector", "URLTest", "Fallback", "LoadBalance", "Relay"];
  const out = [];
  const pushGroup = (name) => {
    const g = proxies[name];
    if (!g) return;
    const all = (g.all || [])
      .map((n) => proxies[n])
      .filter(Boolean)
      .map((p) => ({
        name: p.name,
        type: p.type,
        udp: p.udp,
        network: proxyTransport[p.name] || "",
        delay: p.history && p.history.length ? p.history[p.history.length - 1].delay : 0,
      }));
    out.push({ name: g.name, type: g.type, now: g.now, all: all });
  };
  const global = proxies["GLOBAL"];
  if (global && Array.isArray(global.all)) {
    pushGroup("GLOBAL");
    for (const n of global.all) {
      const p = proxies[n];
      if (p && GROUP_TYPES.includes(p.type)) pushGroup(n);
    }
  }
  if (out.length <= 1) {
    for (const k of Object.keys(proxies)) {
      const p = proxies[k];
      if (p && GROUP_TYPES.includes(p.type)) pushGroup(k);
    }
  }
  return out;
}
const FLAG_DIR = path.join(app.getPath("userData"), "flags");
const COUNTRY_MAP = {
  netherl: "nl",
  нидерланд: "nl",
  germ: "de",
  герман: "de",
  finland: "fi",
  финлянд: "fi",
  sweden: "se",
  швец: "se",
  norway: "no",
  норвег: "no",
  denmark: "dk",
  дани: "dk",
  france: "fr",
  франц: "fr",
  spain: "es",
  испан: "es",
  italy: "it",
  итали: "it",
  "united kingdom": "gb",
  britain: "gb",
  англ: "gb",
  британ: "gb",
  poland: "pl",
  польш: "pl",
  czech: "cz",
  чех: "cz",
  switzer: "ch",
  швейцар: "ch",
  austria: "at",
  австри: "at",
  serbia: "rs",
  серби: "rs",
  bosnia: "ba",
  босни: "ba",
  bulgaria: "bg",
  болгар: "bg",
  hungary: "hu",
  венгр: "hu",
  romania: "ro",
  румын: "ro",
  lithuania: "lt",
  литв: "lt",
  latvia: "lv",
  estonia: "ee",
  macedonia: "mk",
  македон: "mk",
  albania: "al",
  албан: "al",
  armenia: "am",
  армени: "am",
  azerbaijan: "az",
  азербайдж: "az",
  belarus: "by",
  беларус: "by",
  kazakh: "kz",
  казахст: "kz",
  uzbek: "uz",
  узбек: "uz",
  cyprus: "cy",
  кипр: "cy",
  russia: "ru",
  росси: "ru",
  ukrain: "ua",
  украин: "ua",
  turkey: "tr",
  турци: "tr",
  usa: "us",
  "united states": "us",
  сша: "us",
  america: "us",
  canada: "ca",
  канад: "ca",
  brazil: "br",
  бразил: "br",
  thailand: "th",
  таиланд: "th",
  vietnam: "vn",
  вьетнам: "vn",
  japan: "jp",
  япони: "jp",
  indonesia: "id",
  индонез: "id",
  singapore: "sg",
  сингапур: "sg",
  "hong kong": "hk",
  гонконг: "hk",
  australia: "au",
  австрал: "au",
  nigeria: "ng",
  нигери: "ng",
  "south africa": "za",
  индия: "in",
  india: "in",
  china: "cn",
  китай: "cn",
  korea: "kr",
  корея: "kr",
};
function flagCodeFromName(name) {
  name = String(name || "");
  const pts = [];
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i);
    if (cp > 65535) i++;
    if (cp >= 127462 && cp <= 127487) pts.push(cp);
    if (pts.length === 2) break;
  }
  if (pts.length === 2)
    return String.fromCharCode(pts[0] - 127462 + 97) + String.fromCharCode(pts[1] - 127462 + 97);
  const low = name.toLowerCase();
  for (const k in COUNTRY_MAP) if (low.includes(k)) return COUNTRY_MAP[k];
  return null;
}
function flagIcon(name) {
  const code = flagCodeFromName(name);
  if (!code) return undefined;
  try {
    const p = path.join(FLAG_DIR, code + ".png");
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.resize({ height: 14 });
    }
  } catch (_) {}
  return undefined;
}
function downloadFlag(code) {
  return new Promise((res) => {
    try {
      const p = path.join(FLAG_DIR, code + ".png");
      if (fs.existsSync(p)) return res();
      fs.mkdirSync(FLAG_DIR, { recursive: true });
      const f = fs.createWriteStream(p);
      const req = net.request("https://flagcdn.com/20x15/" + code + ".png");
      req.on("response", (r) => {
        if (r.statusCode !== 200) {
          try {
            f.close();
            fs.unlinkSync(p);
          } catch (_) {}
          return res();
        }
        r.on("data", (c) => f.write(c));
        r.on("end", () => f.end(() => res()));
        r.on("error", () => res());
      });
      req.on("error", () => res());
      req.end();
    } catch (_) {
      res();
    }
  });
}
async function prefetchFlags(groups) {
  const codes = new Set();
  (groups || []).forEach((g) =>
    (g.all || []).forEach((p) => {
      const c = flagCodeFromName(p && p.name);
      if (c) codes.add(c);
    }),
  );
  for (const c of codes) {
    try {
      await downloadFlag(c);
    } catch (_) {}
  }
}
let lastGroups = [];
async function selectServer(group, name) {
  await ensureCore();
  const groups = new Set([group, "GLOBAL"]);
  try {
    (lastGroups || []).forEach((g) => {
      if (g.all && g.all.some((p) => p.name === name)) groups.add(g.name);
    });
  } catch (_) {}
  for (const gn of groups) {
    try {
      await bridge.changeProxy(gn, name);
    } catch (_) {}
  }
  if (state.running) {
    try {
      await bridge.closeConnections();
    } catch (_) {}
  }
  settings.selected = settings.selected || {};
  groups.forEach((gn) => {
    settings.selected[gn] = name;
  });
  state.currentServer = name;
  settings.currentServer = name;
  saveSettings();
  try {
    lastGroups.forEach((g) => {
      if (g.all && g.all.some((p) => p.name === name)) g.now = name;
    });
  } catch (_) {}
  send("vpn:state", state);
  refreshTray();
}
function registerIpc() {
  ipcMain.on("app:diag", (_e, m) => diag("R: " + m));
  ipcMain.handle("app:systemAccent", () => {
    try {
      const { systemPreferences: systemPreferences } = require("electron");
      const c = systemPreferences.getAccentColor();
      return c ? "#" + String(c).substring(0, 6) : null;
    } catch (_) {
      return null;
    }
  });
  ipcMain.handle("app:getSettings", () => settings);
  ipcMain.handle("app:saveSettings", (_e, patch) => {
    Object.assign(settings, patch);
    saveSettings();
    if (settings.nativeFrame && patch && ("theme" in patch || "oled" in patch)) {
      try {
        if (win && !win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlayFor(settings));
      } catch (_) {}
    }
    return settings;
  });
  ipcMain.handle("win:nativeFrame", (_e, on) => {
    settings.nativeFrame = !!on;
    saveSettings();
    setTimeout(() => {
      try {
        recreateWindow(true);
      } catch (e) {
        diag("nativeFrame recreate: " + e.message);
      }
    }, 120);
    return true;
  });
  ipcMain.handle("app:getState", () => state);
  ipcMain.handle("app:openExternal", (_e, url) => {
    try {
      const u = new URL(String(url));
      if (!["https:", "http:", "tg:"].includes(u.protocol)) return false;
      shell.openExternal(u.href);
      return true;
    } catch (_) {
      return false;
    }
  });
  ipcMain.handle("app:coreStatus", () => ({
    alive: !!(bridge && bridge.isAlive()),
    init: !!(bridge && bridge.isInit),
  }));
  ipcMain.handle("mini:open", () => {
    openMini();
    return true;
  });
  ipcMain.handle("mini:close", (_e, showMain) => {
    closeMini(showMain !== false);
    return true;
  });
  ipcMain.handle("vpn:connect", async () => {
    try {
      return { ok: true, state: await connect() };
    } catch (e) {
      return { ok: false, error: e.message, needAdmin: !!e.needAdmin };
    }
  });
  ipcMain.handle("app:isAdmin", () => isAdmin());
  ipcMain.handle("app:relaunchAdmin", () => {
    relaunchAdmin();
    return true;
  });
  ipcMain.handle("vpn:requestAdmin", async () => {
    try {
      const { response: response } = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Перезапустить от администратора", "Отмена"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: "Нужны права администратора",
        message: "Режим TUN (виртуальный адаптер) требует прав администратора.",
        detail: "SnowVPN перезапустится с запросом UAC. Подтвердите в окне Windows.",
      });
      if (response === 0) {
        relaunchAdmin();
        return { ok: true };
      }
      return { ok: false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("vpn:disconnect", async () => {
    try {
      return { ok: true, state: await disconnect() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("vpn:setNetMode", async (_e, mode) => {
    if (mode !== "tun" && mode !== "proxy") return { ok: false };
    const was = state.running;
    if (was) await disconnect();
    state.netMode = mode;
    settings.netMode = mode;
    saveSettings();
    if (was) {
      try {
        await connect();
      } catch (e) {
        return { ok: false, error: e.message, state: state };
      }
    }
    send("vpn:state", state);
    return { ok: true, state: state };
  });
  ipcMain.handle("vpn:setRouteMode", async (_e, mode) => {
    if (!["rule", "global", "direct"].includes(mode)) return { ok: false };
    state.routeMode = mode;
    settings.routeMode = mode;
    saveSettings();
    try {
      if (state.hasProfile) await applyActive();
    } catch (_) {}
    return { ok: true, state: state };
  });
  ipcMain.handle("sub:list", () => ({ subs: settings.subs, active: state.activeSub }));
  ipcMain.handle("sub:import", async (_e, { url: url, name: name }) => {
    try {
      await importSub(url, name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message, needSub: !!e.needSub };
    }
  });
  ipcMain.handle("sub:update", async (_e, id) => {
    try {
      await updateSub(id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("sub:remove", async (_e, id) => {
    try {
      await removeSub(id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("sub:edit", async (_e, { id: id, name: name, url: url, endpoint: endpoint }) => {
    try {
      await editSub(id, { name: name, url: url, endpoint: endpoint });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("sub:setActive", async (_e, id) => {
    try {
      await setActive(id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("proxies:groups", async () => {
    try {
      const g = await getProxyGroups();
      lastGroups = g;
      refreshTray();
      prefetchFlags(g).then(refreshTray);
      return { ok: true, groups: g };
    } catch (e) {
      return { ok: false, error: e.message, groups: [] };
    }
  });
  ipcMain.handle("proxy:select", async (_e, { group: group, name: name }) => {
    try {
      await selectServer(group, name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("proc:list", () => {
    if (process.platform === "darwin") {
      try {
        const out = execSync("ps -A -o comm=", { encoding: "utf8" });
        const set = new Set();
        out.split(/\r?\n/).forEach((l) => {
          const trimmed = l.trim();
          if (trimmed.includes(".app/Contents/MacOS/")) {
            const m = trimmed.match(/\/([^/]+)\.app\/Contents\/MacOS\/([^/]+)$/);
            if (m) set.add(m[2]);
          } else if (trimmed) {
            set.add(path.basename(trimmed));
          }
        });
        return Array.from(set).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      } catch (_) {
        return [];
      }
    }
    try {
      const out = execSync("tasklist /fo csv /nh", { encoding: "utf8", windowsHide: true });
      const set = new Set();
      out.split(/\r?\n/).forEach((l) => {
        const m = l.match(/^"([^"]+\.exe)"/i);
        if (m) set.add(m[1]);
      });
      return Array.from(set).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    } catch (_) {
      return [];
    }
  });
  let _appsCache = { t: 0, list: [] };
  ipcMain.handle("apps:list", async () => {
    if (_appsCache.list.length && Date.now() - _appsCache.t < 5 * 6e4) return _appsCache.list;
    if (process.platform === "darwin") {
      const dirs = ["/Applications", "/System/Applications", path.join(os.homedir(), "Applications")];
      const seen = new Map();
      for (const d of dirs) {
        try {
          if (!fs.existsSync(d)) continue;
          const files = fs.readdirSync(d);
          for (const f of files) {
            if (f.endsWith(".app")) {
              const name = f.replace(/\.app$/, "");
              const appPath = path.join(d, f);
              seen.set(name.toLowerCase(), { name: name, exe: name, path: appPath });
            }
          }
        } catch (_) {}
      }
      try {
        const out = execSync("ps -A -o comm=", { encoding: "utf8" });
        const runningSet = new Set(
          out
            .split(/\r?\n/)
            .map((l) => path.basename(l.trim()))
            .filter(Boolean)
            .map((x) => x.toLowerCase()),
        );
        for (const [k, item] of seen.entries()) {
          if (runningSet.has(k)) item.running = true;
        }
      } catch (_) {}
      _appsCache = {
        t: Date.now(),
        list: Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, "ru")),
      };
      return _appsCache.list;
    }
    const ps = [
      "$sh = New-Object -ComObject WScript.Shell",
      "$dirs = @([Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('Programs'))",
      "$out = New-Object System.Collections.ArrayList",
      "foreach ($d in $dirs) { Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {",
      "  try { $t = $sh.CreateShortcut($_.FullName).TargetPath",
      "    if ($t -and $t -like '*.exe' -and (Test-Path -LiteralPath $t)) { [void]$out.Add([PSCustomObject]@{ n = $_.BaseName; p = $t }) } } catch {}",
      "} }",
      "ConvertTo-Json -Compress -InputObject $out",
    ].join("; ");
    const raw = await new Promise((resolve) => {
      try {
        const { execFile: execFile } = require("child_process");
        execFile(
          "powershell",
          ["-NoProfile", "-NonInteractive", "-Command", ps],
          { windowsHide: true, timeout: 2e4, maxBuffer: 4 * 1024 * 1024 },
          (err, out) => resolve(err ? "" : String(out || "")),
        );
      } catch (_) {
        resolve("");
      }
    });
    let arr = [];
    try {
      const j = JSON.parse(raw.trim());
      arr = Array.isArray(j) ? j : j ? [j] : [];
    } catch (_) {}
    const NOISE = /unins|uninstall|setup|installer|repair|updater|update\.exe/i;
    const seen = new Map();
    for (const a of arr) {
      if (!a || !a.p || !a.n) continue;
      const exe = path.basename(a.p);
      if (NOISE.test(exe) || NOISE.test(a.n)) continue;
      const key = exe.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name: a.n, exe: exe, path: a.p });
    }
    try {
      const out = execSync("tasklist /fo csv /nh", { encoding: "utf8", windowsHide: true });
      out.split(/\r?\n/).forEach((l) => {
        const m = l.match(/^"([^"]+\.exe)"/i);
        if (m && !NOISE.test(m[1])) {
          const key = m[1].toLowerCase();
          if (seen.has(key)) seen.get(key).running = true;
          else
            seen.set(key, {
              name: m[1].replace(/\.exe$/i, ""),
              exe: m[1],
              path: null,
              running: true,
            });
        }
      });
    } catch (_) {}
    const list = Array.from(seen.values()).sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "ru"),
    );
    _appsCache = { t: Date.now(), list: list };
    return list;
  });
  const _iconCache = new Map();
  ipcMain.handle("apps:icon", async (_e, p) => {
    if (!p || typeof p !== "string") return null;
    if (_iconCache.has(p)) return _iconCache.get(p);
    try {
      const img = await app.getFileIcon(p, { size: "normal" });
      const d = img && !img.isEmpty() ? img.toDataURL() : null;
      _iconCache.set(p, d);
      return d;
    } catch (_) {
      _iconCache.set(p, null);
      return null;
    }
  });
  ipcMain.handle("proxy:delay", async (_e, arg) => {
    const name = typeof arg === "string" ? arg : arg.name;
    const method = (typeof arg === "object" && arg.method) || "http";
    const url = (typeof arg === "object" && arg.url) || "https://www.gstatic.com/generate_204";
    try {
      if (method === "tcp") {
        let a = nodeAddrs[name];
        if (!a || !a.server) {
          const norm = (s) => String(s).trim().toLowerCase();
          const key = Object.keys(nodeAddrs).find((k) => norm(k) === norm(name));
          if (key) a = nodeAddrs[key];
        }
        if (a && a.server) {
          const d = await tcpPing(a.server, a.port);
          if (d >= 0) return { ok: true, delay: d };
        }
        try {
          const d2 = await bridge.testDelayStable(name);
          return d2.value > 0 ? { ok: true, delay: d2.value } : { ok: false, error: "таймаут" };
        } catch (e2) {
          return { ok: false, error: "таймаут" };
        }
      }
      const d = await bridge.testDelayStable(name, [url, "https://cp.cloudflare.com/generate_204"]);
      return d.value > 0 ? { ok: true, delay: d.value } : { ok: false, error: "таймаут" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("core:connections", async () => {
    try {
      const r = await bridge.getConnections();
      return typeof r === "string" ? JSON.parse(r) : r;
    } catch (e) {
      return { connections: [] };
    }
  });
  ipcMain.handle("stats:get", () => {
    const stats = settings.trafficStats || {};
    const days = Object.keys(stats)
      .sort()
      .slice(-14)
      .map((k) => ({ date: k, up: stats[k].up || 0, down: stats[k].down || 0 }));
    const today = stats[todayKey()] || { up: 0, down: 0 };
    let totUp = 0,
      totDown = 0;
    Object.values(stats).forEach((e) => {
      totUp += e.up || 0;
      totDown += e.down || 0;
    });
    return { today: today, session: lastSession, days: days, allUp: totUp, allDown: totDown };
  });
  ipcMain.handle("rules:get", () => settings.rules || []);
  ipcMain.handle("rules:validate", async (_e, rule) => {
    try {
      return await validateRule(rule);
    } catch (_) {
      return { ok: true, skipped: true };
    }
  });
  ipcMain.handle("geo:sites", () => {
    const c = geoSiteCategories();
    return c ? Array.from(c).sort() : null;
  });
  ipcMain.handle("rules:save", async (_e, rules) => {
    const arr = Array.isArray(rules) ? rules : [];
    const bad = [];
    for (const r of arr) {
      if (!r || r.enabled === false) continue;
      const v = checkRuleValue(r.type, r.value);
      if (!v.ok) {
        r.enabled = false;
        r.invalid = true;
        r.invalidReason = v.error;
        bad.push(r.name || r.value);
      } else if (r.invalid) {
        delete r.invalid;
        delete r.invalidReason;
      }
    }
    settings.rules = arr;
    saveSettings({ allowShrink: true });
    try {
      if (state.hasProfile) await applyActive();
    } catch (e) {
      return { ok: false, error: e.message, invalid: bad, rules: settings.rules };
    }
    return { ok: true, invalid: bad, rules: settings.rules };
  });
  ipcMain.handle("fav:list", () => settings.favorites || []);
  ipcMain.handle("fav:toggle", (_e, name) => {
    settings.favorites = settings.favorites || [];
    const i = settings.favorites.indexOf(name);
    if (i >= 0) settings.favorites.splice(i, 1);
    else settings.favorites.push(name);
    saveSettings();
    return settings.favorites;
  });
  ipcMain.handle("ai:get", () => !!settings.aiDns);
  ipcMain.handle("ai:region:get", () =>
    Object.prototype.hasOwnProperty.call(AI_DNS_REGIONS, settings.aiDnsRegion)
      ? settings.aiDnsRegion
      : "RU",
  );
  ipcMain.handle("ai:region:set", async (_e, region) => {
    if (!Object.prototype.hasOwnProperty.call(AI_DNS_REGIONS, region))
      return { ok: false, error: "Выберите регион RU, EU или US" };
    const previous = settings.aiDnsRegion || "RU";
    settings.aiDnsRegion = region;
    saveSettings();
    try {
      if (settings.aiDns && state.hasProfile) await applyActive();
      return { ok: true, region: region };
    } catch (e) {
      settings.aiDnsRegion = previous;
      saveSettings();
      try {
        if (settings.aiDns && state.hasProfile) await applyActive();
      } catch (_) {}
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("ai:set", async (_e, on) => {
    settings.aiDns = !!on;
    saveSettings();
    try {
      if (state.hasProfile) await applyActive();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("ru:get", () => !!settings.ruOptimization);
  ipcMain.handle("ru:set", async (_e, on) => {
    settings.ruOptimization = !!on;
    saveSettings();
    try {
      if (state.hasProfile) await applyActive();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("ruSites:get", () => !!settings.ruSitesVpn);
  ipcMain.handle("ruSites:set", async (_e, on) => {
    settings.ruSitesVpn = !!on;
    saveSettings();
    try {
      if (state.hasProfile) await applyActive();
      if (on && state.routeMode === "global")
        return { ok: true, warning: "Правило работает в режиме «По приложениям»" };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("dns:get", () => ({
    mode: settings.dnsMode || "auto",
    custom: Array.isArray(settings.dnsCustom) ? settings.dnsCustom : [],
    presets: Object.keys(DNS_PRESETS),
    effective: dnsResolvers(),
  }));
  ipcMain.handle("dns:set", async (_e, cfg) => {
    cfg = cfg || {};
    if (typeof cfg.mode === "string") settings.dnsMode = cfg.mode;
    if (Array.isArray(cfg.custom))
      settings.dnsCustom = cfg.custom.map((s) => String(s || "").trim()).filter(Boolean);
    saveSettings();
    const eff = dnsResolvers();
    if (!eff.length)
      return {
        ok: false,
        error:
          "Не удалось разобрать DNS. Нужен IP, DoH-ссылка или udp://IP для обычного DNS. DoT (:853) не поддерживается.",
      };
    try {
      if (state.hasProfile) await applyActive();
      return { ok: true, effective: eff };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("killswitch:get", () => !!settings.killSwitch);
  ipcMain.handle("killswitch:set", async (_e, on) => {
    settings.killSwitch = !!on;
    saveSettings();
    try {
      if (on && state.running) {
        settings.ksActive = true;
        saveSettings();
        const r = await killSwitch.engage(CORE_EXE, process.execPath, TUN_DEVICE);
        diag("killswitch set: " + JSON.stringify(r));
        if (!r.ok) {
          settings.killSwitch = false;
          settings.ksActive = false;
          saveSettings();
          return { ok: false, error: r.error || "Не удалось включить Kill Switch" };
        }
        if (r.fwOff)
          return {
            ok: true,
            engaged: true,
            warning: "Брандмауэр Windows выключен — Kill Switch не защитит от утечек",
          };
      } else if (!on) await ksCleanup();
    } catch (e) {
      return { ok: false, error: e.message };
    }
    return { ok: true, engaged: killSwitch.isEngaged() };
  });
  ipcMain.handle("autostart:get", () => {
    try {
      return (
        !!settings.autostart || autostartTaskExists() || app.getLoginItemSettings().openAtLogin
      );
    } catch (_) {
      return !!settings.autostart;
    }
  });
  ipcMain.handle("autostart:set", (_e, on) => {
    settings.autostart = !!on;
    saveSettings();
    return setAutostart(!!on);
  });
  ipcMain.handle("admin:getAlways", () => {
    try {
      return getAlwaysAdmin() || !!settings.alwaysAdmin;
    } catch (_) {
      return !!settings.alwaysAdmin;
    }
  });
  ipcMain.handle("admin:setAlways", (_e, on) => {
    settings.alwaysAdmin = !!on;
    saveSettings();
    return setAlwaysAdmin(!!on);
  });
  ipcMain.handle("admin:restartElevated", () => {
    try {
      relaunchAdmin();
      return true;
    } catch (_) {
      return false;
    }
  });
  ipcMain.handle("backup:export", async () => {
    try {
      const { canceled: canceled, filePath: filePath } = await dialog.showSaveDialog(win, {
        title: "Сохранить резервную копию",
        defaultPath: "snowvpn-backup.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (canceled || !filePath) return { ok: false };
      const profiles = {};
      for (const s of settings.subs) {
        try {
          profiles[s.id] = fs.readFileSync(profilePath(s.id), "utf8");
        } catch (_) {}
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({ settings: settings, profiles: profiles }, null, 2),
      );
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("backup:import", async () => {
    try {
      const { canceled: canceled, filePaths: filePaths } = await dialog.showOpenDialog(win, {
        title: "Выбрать резервную копию",
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["openFile"],
      });
      if (canceled || !filePaths[0]) return { ok: false };
      const data = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
      if (data.profiles)
        for (const id of Object.keys(data.profiles))
          fs.writeFileSync(profilePath(id), data.profiles[id], "utf8");
      if (data.settings) {
        settings = Object.assign(settings, data.settings);
        saveSettings({ allowShrink: true });
      }
      state.activeSub = settings.activeSub;
      state.hasProfile = false;
      try {
        await applyActive();
      } catch (_) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("hotkey:set", (_e, { accelerator: accelerator, enabled: enabled }) => {
    settings.hotkey = accelerator || settings.hotkey || "CommandOrControl+Alt+S";
    settings.hotkeyEnabled = !!enabled;
    saveSettings();
    registerHotkey();
    return { ok: true, accelerator: settings.hotkey };
  });
  ipcMain.handle("hotkey:get", () => ({
    accelerator: settings.hotkey || "CommandOrControl+Alt+S",
    enabled: !!settings.hotkeyEnabled,
  }));
  ipcMain.handle("bg:pick", async () => {
    try {
      const { canceled: canceled, filePaths: filePaths } = await dialog.showOpenDialog(win, {
        title: "Выберите фото для фона",
        filters: [
          { name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] },
        ],
        properties: ["openFile"],
      });
      if (canceled || !filePaths[0]) return { ok: false };
      const ext = path.extname(filePaths[0]) || ".jpg";
      const dest = path.join(app.getPath("userData"), "bg" + ext);
      fs.copyFileSync(filePaths[0], dest);
      settings.bgImage = dest;
      saveSettings();
      return { ok: true, path: dest };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("bg:clear", () => {
    settings.bgImage = null;
    saveSettings();
    return { ok: true };
  });
  ipcMain.handle("avatar:pick", async () => {
    try {
      const { canceled: canceled, filePaths: filePaths } = await dialog.showOpenDialog(win, {
        title: "Выберите фото для аватара",
        filters: [
          { name: "Изображения", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] },
        ],
        properties: ["openFile"],
      });
      if (canceled || !filePaths[0]) return { ok: false };
      const ext = path.extname(filePaths[0]) || ".jpg";
      const dest = path.join(app.getPath("userData"), "avatar" + ext);
      fs.copyFileSync(filePaths[0], dest);
      settings.avatarImage = dest;
      saveSettings();
      return { ok: true, path: dest };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("avatar:clear", () => {
    settings.avatarImage = null;
    saveSettings();
    return { ok: true };
  });
  ipcMain.handle("manual:state", () => ({
    unlocked: !!settings.devUnlocked,
    userAgent: settings.devUserAgent || "",
    force: !!settings.devForce,
  }));
  ipcMain.handle("manual:unlock", () => {
    settings.devUnlocked = true;
    saveSettings();
    return { ok: true };
  });
  ipcMain.handle("manual:lock", () => {
    settings.devUnlocked = false;
    settings.devUserAgent = "";
    settings.devForce = false;
    saveSettings();
    return { ok: true };
  });
  ipcMain.handle("manual:setUa", (_e, ua) => {
    settings.devUserAgent = String(ua || "").slice(0, 300);
    saveSettings();
    return { ok: true };
  });
  ipcMain.handle("manual:setForce", (_e, on) => {
    settings.devForce = !!on;
    saveSettings();
    return { ok: true };
  });
  ipcMain.handle("manual:add", async () => {
    try {
      const { canceled: canceled, filePaths: filePaths } = await dialog.showOpenDialog(win, {
        title: "Выберите файл конфигурации (AmneziaWG / WireGuard)",
        filters: [{ name: "Конфигурации", extensions: ["conf", "yaml", "yml"] }],
        properties: ["openFile"],
      });
      if (canceled || !filePaths[0]) return { ok: false };
      const { id: id, name: name } = await addLocalConfig(filePaths[0]);
      return { ok: true, id: id, name: name, subs: settings.subs };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("app:openConfigFolder", () => {
    shell.openPath(HOME_DIR);
    return true;
  });
  ipcMain.handle("app:factoryReset", async () => {
    try {
      const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : null, {
        type: "warning",
        noLink: true,
        defaultId: 1,
        cancelId: 1,
        buttons: ["Сбросить и перезапустить", "Отмена"],
        title: "Сброс приложения",
        message: "Сбросить SnowVPN до заводских настроек?",
        detail:
          "Удалятся все подписки, свои конфиги, правила и настройки интерфейса. Приложение отключится от VPN и перезапустится. Логи (snowvpn-diag.log) не трогаются.",
      });
      if (r.response !== 0) return { ok: false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
    diag("=== ФАБРИЧНЫЙ СБРОС по запросу пользователя ===");
    try {
      if (state.running) await disconnect();
    } catch (_) {}
    try {
      await Promise.race([ksCleanup(), new Promise((res) => setTimeout(res, 2500))]);
    } catch (_) {}
    try {
      if (bridge) await bridge.stop();
    } catch (_) {}
    const ud = app.getPath("userData");
    const targets = [
      SETTINGS_DIR,
      HOME_DIR,
      SAFE_MODE_FLAG,
      START_MARK,
      ADMIN_RETRY_STATE,
      RENDER_FAIL_STATE,
      FLAG_DIR,
    ];
    try {
      fs.readdirSync(ud).forEach((f) => {
        if (/^(bg|avatar)\.[a-z0-9]+$/i.test(f)) targets.push(path.join(ud, f));
      });
    } catch (_) {}
    let failed = null;
    targets.forEach((t) => {
      try {
        fs.rmSync(t, { recursive: true, force: true });
      } catch (e) {
        failed = failed || e.message;
      }
    });
    if (failed)
      diag("factoryReset: часть файлов не удалилась (" + failed + "), перезапускаю всё равно");
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
  ipcMain.handle("app:toggleDevTools", () => {
    if (win) win.webContents.toggleDevTools();
    return true;
  });
  ipcMain.handle("app:about", () => ({
    version: CLIENT_VERSION,
    core: "mihomo 1.19.27",
    hwid: getHWID(),
    admin: isAdmin(),
    home: HOME_DIR,
  }));
  ipcMain.handle(
    "update:check",
    () =>
      new Promise((resolve) => {
        try {
          const req = net.request({ url: UPDATE_URL + "?_=" + Date.now() });
          let d = "";
          req.on("response", (res) => {
            res.on("data", (c) => (d += c));
            res.on("end", () => {
              try {
                const j = JSON.parse(d);
                lastUpdateInfo = {
                  version: j.version || "",
                  url: j.url,
                  sha256: (j.sha256 || "").toLowerCase() || null,
                  appUrl: j.appUrl || null,
                  appSha256: (j.appSha256 || "").toLowerCase() || null,
                };
                const badCore = coreMismatch();
                resolve({
                  ok: true,
                  available: badCore || cmpVer(j.version, CLIENT_VERSION) > 0,
                  version: j.version,
                  changelog: j.changelog || "",
                  url: j.url,
                  appUrl: badCore ? null : j.appUrl || null,
                  appRuntime: j.runtime || null,
                  current: CLIENT_VERSION,
                  coreMismatch: badCore,
                });
              } catch (_) {
                resolve({ ok: false, current: CLIENT_VERSION });
              }
            });
            res.on("error", () => resolve({ ok: false, current: CLIENT_VERSION }));
          });
          req.on("error", () => resolve({ ok: false, current: CLIENT_VERSION }));
          req.end();
          setTimeout(() => resolve({ ok: false, current: CLIENT_VERSION }), 8e3);
        } catch (_) {
          resolve({ ok: false, current: CLIENT_VERSION });
        }
      }),
  );
  ipcMain.handle("update:pendingGet", () => {
    try {
      const p = settings.pendingUpdateExe;
      if (p && fs.existsSync(p))
        return { has: true, version: settings.pendingUpdateVer || "", size: fs.statSync(p).size };
      if (p) {
        settings.pendingUpdateExe = null;
        settings.pendingUpdateVer = null;
        saveSettings({ allowShrink: true });
      }
    } catch (_) {}
    return { has: false };
  });
  ipcMain.handle("update:pendingRun", () => {
    try {
      const p = settings.pendingUpdateExe;
      if (!p || !fs.existsSync(p)) return { ok: false, error: "файл обновления не найден" };
      settings.pendingUpdateExe = null;
      settings.pendingUpdateVer = null;
      saveSettings({ allowShrink: true });
      runInstaller(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("update:pendingDrop", () => {
    try {
      const p = settings.pendingUpdateExe;
      if (p) {
        try {
          fs.unlinkSync(p);
        } catch (_) {}
      }
      settings.pendingUpdateExe = null;
      settings.pendingUpdateVer = null;
      saveSettings({ allowShrink: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle(
    "update:changelog",
    () =>
      new Promise((resolve) => {
        const done = (v) => resolve(v);
        try {
          const req = net.request({ url: CHANGELOG_URL + "?_=" + Date.now() });
          let d = "";
          req.on("response", (res) => {
            res.on("data", (c) => (d += c));
            res.on("end", () => {
              try {
                const j = JSON.parse(d);
                const arr = Array.isArray(j) ? j : j.versions || [];
                const list = arr
                  .filter((x) => x && x.version)
                  .map((x) => ({
                    version: String(x.version),
                    date: x.date || "",
                    notes: x.notes || "",
                    isNew: cmpVer(x.version, CLIENT_VERSION) > 0,
                  }))
                  .sort((a, b) => cmpVer(b.version, a.version));
                done({ ok: true, current: CLIENT_VERSION, list: list });
              } catch (_) {
                done({ ok: false, current: CLIENT_VERSION, list: [] });
              }
            });
            res.on("error", () => done({ ok: false, current: CLIENT_VERSION, list: [] }));
          });
          req.on("error", () => done({ ok: false, current: CLIENT_VERSION, list: [] }));
          req.end();
          setTimeout(() => done({ ok: false, current: CLIENT_VERSION, list: [] }), 8e3);
        } catch (_) {
          done({ ok: false, current: CLIENT_VERSION, list: [] });
        }
      }),
  );
  const UPDATE_HOSTS = ["45.8.93.251", "snowservice.cc", "www.snowservice.cc"];
  const isUpdateUrl = (u) => {
    try {
      const p = new URL(String(u));
      return ["http:", "https:"].includes(p.protocol) && UPDATE_HOSTS.includes(p.hostname);
    } catch (_) {
      return false;
    }
  };
  ipcMain.handle(
    "update:install",
    (_e, url) =>
      new Promise((resolve) => {
        const sendP = (o) => {
          try {
            if (win && !win.isDestroyed()) win.webContents.send("update:progress", o);
          } catch (_) {}
        };
        if (!isUpdateUrl(url)) {
          resolve({ ok: false, error: "недопустимый адрес обновления" });
          return;
        }
        try {
          const tmp = path.join(app.getPath("temp"), "SnowVPN-Update-Setup.exe");
          try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
          } catch (_) {}
          const file = fs.createWriteStream(tmp);
          let received = 0,
            total = 0,
            lastPct = -1,
            done = false;
          const fail = (msg) => {
            if (done) return;
            done = true;
            try {
              file.close();
            } catch (_) {}
            sendP({ error: msg });
            resolve({ ok: false, error: msg });
          };
          const req = net.request(url);
          req.on("response", (res) => {
            if (res.statusCode !== 200) {
              fail("HTTP " + res.statusCode);
              return;
            }
            total =
              parseInt(res.headers["content-length"] || res.headers["Content-Length"] || 0, 10) ||
              0;
            res.on("data", (c) => {
              received += c.length;
              file.write(c);
              const pct = total ? Math.round((received / total) * 100) : 0;
              if (pct !== lastPct) {
                lastPct = pct;
                sendP({ pct: pct, received: received, total: total });
              }
            });
            res.on("end", () => {
              if (done) return;
              file.end(async () => {
                try {
                  if (total && received < total) {
                    fail("Загружено не полностью");
                    return;
                  }
                  const expectedHash =
                    lastUpdateInfo && lastUpdateInfo.url === url ? lastUpdateInfo.sha256 : null;
                  if (expectedHash) {
                    const actualHash = crypto
                      .createHash("sha256")
                      .update(fs.readFileSync(tmp))
                      .digest("hex");
                    if (actualHash !== expectedHash) {
                      try {
                        fs.unlinkSync(tmp);
                      } catch (_) {}
                      fail(
                        "Файл повреждён или подменён при загрузке (sha256 не совпал) — попробуйте ещё раз",
                      );
                      return;
                    }
                  }
                  const thumb = await checkAuthenticodeThumbprint(tmp);
                  if (thumb !== TRUSTED_CERT_THUMBPRINT) {
                    try {
                      fs.unlinkSync(tmp);
                    } catch (_) {}
                    fail(
                      "Подпись установщика не распознана — установка отменена в целях безопасности. Попробуйте скачать вручную с snowservice.cc",
                    );
                    return;
                  }
                  done = true;
                  sendP({ pct: 100, received: received, total: total, ready: true });
                  try {
                    showWindow();
                  } catch (_) {}
                  let choice = 0;
                  try {
                    const { dialog: dialog } = require("electron");
                    const r = await dialog.showMessageBox(win && !win.isDestroyed() ? win : null, {
                      type: "question",
                      noLink: true,
                      defaultId: 0,
                      cancelId: 2,
                      buttons: ["Перезапустить и установить", "При следующем запуске", "Отмена"],
                      title: "Обновление готово",
                      message: "Обновление SnowVPN загружено",
                      detail:
                        "Установить сейчас (приложение перезапустится) или отложить до следующего запуска?",
                    });
                    choice = r.response;
                  } catch (_) {
                    choice = 0;
                  }
                  if (choice === 2) {
                    sendP({ cancelled: true });
                    resolve({ ok: true, cancelled: true });
                    return;
                  }
                  if (choice === 1) {
                    try {
                      const pend = path.join(SETTINGS_DIR, "pending-update.exe");
                      fs.copyFileSync(tmp, pend);
                      settings.pendingUpdateExe = pend;
                      settings.pendingUpdateVer = (lastUpdateInfo && lastUpdateInfo.version) || "";
                      saveSettings();
                      sendP({ deferred: true });
                      resolve({ ok: true, deferred: true });
                      return;
                    } catch (e) {}
                  }
                  resolve({ ok: true });
                  runInstaller(tmp);
                } catch (e) {
                  fail(e.message);
                }
              });
            });
            res.on("error", (e) => fail(e.message));
          });
          req.on("error", (e) => fail(e.message));
          req.end();
        } catch (e) {
          sendP({ error: e.message });
          resolve({ ok: false, error: e.message });
        }
      }),
  );
  ipcMain.handle(
    "update:delta",
    (_e, appUrl, appRuntime) =>
      new Promise((resolve) => {
        const sendP = (o) => {
          try {
            if (win && !win.isDestroyed()) win.webContents.send("update:progress", o);
          } catch (_) {}
        };
        if (!isUpdateUrl(appUrl)) {
          resolve({ ok: false, error: "недопустимый адрес обновления" });
          return;
        }
        try {
          if (!app.isPackaged) {
            resolve({ ok: false, error: "только в установленной версии" });
            return;
          }
          if (appRuntime && appRuntime !== RUNTIME_ID) {
            resolve({ ok: false, error: "runtime mismatch", needFull: true });
            return;
          }
          const appDir = path.join(process.resourcesPath, "app");
          const zip = path.join(app.getPath("temp"), "SnowVPN-delta.zip");
          const ext = path.join(app.getPath("temp"), "SnowVPN-delta");
          try {
            if (fs.existsSync(zip)) fs.unlinkSync(zip);
          } catch (_) {}
          try {
            fs.rmSync(ext, { recursive: true, force: true });
          } catch (_) {}
          const file = fs.createWriteStream(zip);
          let received = 0,
            total = 0,
            lastPct = -1,
            done = false;
          const fail = (m) => {
            if (done) return;
            done = true;
            try {
              file.close();
            } catch (_) {}
            sendP({ error: m });
            resolve({ ok: false, error: m });
          };
          const req = net.request(appUrl);
          req.on("response", (res) => {
            if (res.statusCode !== 200) {
              fail("HTTP " + res.statusCode);
              return;
            }
            total = parseInt(res.headers["content-length"] || 0, 10) || 0;
            res.on("data", (c) => {
              received += c.length;
              file.write(c);
              const pct = total ? Math.round((received / total) * 100) : 0;
              if (pct !== lastPct) {
                lastPct = pct;
                sendP({ pct: pct, received: received, total: total });
              }
            });
            res.on("end", () => {
              if (done) return;
              file.end(() => {
                try {
                  if (total && received < total) {
                    fail("Загружено не полностью");
                    return;
                  }
                  const expectedHash =
                    lastUpdateInfo && lastUpdateInfo.appUrl === appUrl
                      ? lastUpdateInfo.appSha256
                      : null;
                  if (expectedHash) {
                    const actualHash = crypto
                      .createHash("sha256")
                      .update(fs.readFileSync(zip))
                      .digest("hex");
                    if (actualHash !== expectedHash) {
                      try {
                        fs.unlinkSync(zip);
                      } catch (_) {}
                      fail("Файл повреждён или подменён при загрузке (sha256 не совпал)");
                      return;
                    }
                  }
                  done = true;
                  sendP({ pct: 100, received: received, total: total, ready: true });
                  const { spawn: spawn } = require("child_process");
                  sendP({ stage: "extract" });
                  try {
                    fs.rmSync(ext, { recursive: true, force: true });
                  } catch (_) {}
                  const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
                  let applied = false;
                  const failSoft = (m) => {
                    if (applied) return;
                    applied = true;
                    sendP({ error: m });
                    resolve({ ok: false, error: m, needFull: true });
                  };
                  const ps = spawn(
                    "powershell",
                    [
                      "-NoProfile",
                      "-ExecutionPolicy",
                      "Bypass",
                      "-Command",
                      "Expand-Archive -Force -LiteralPath " +
                        psq(zip) +
                        " -DestinationPath " +
                        psq(ext),
                    ],
                    { windowsHide: true, stdio: "ignore" },
                  );
                  const psTimer = setTimeout(() => {
                    try {
                      ps.kill();
                    } catch (_) {}
                    failSoft("распаковка зависла");
                  }, 12e4);
                  ps.on("error", () => {
                    clearTimeout(psTimer);
                    failSoft("не удалось запустить распаковку");
                  });
                  ps.on("exit", (code) => {
                    clearTimeout(psTimer);
                    if (applied) return;
                    try {
                      if (
                        code !== 0 ||
                        !fs.existsSync(path.join(ext, "main.js")) ||
                        !fs.existsSync(path.join(ext, "renderer", "index.html"))
                      ) {
                        failSoft("распаковка не удалась");
                        return;
                      }
                      sendP({ stage: "apply" });
                      fs.cpSync(ext, appDir, { recursive: true, force: true });
                      applied = true;
                      sendP({ stage: "restart" });
                      resolve({ ok: true });
                      setTimeout(() => {
                        try {
                          if (bridge) bridge.stop();
                        } catch (_) {}
                        try {
                          forceKillAll();
                        } catch (_) {}
                        isQuitting = true;
                        app.relaunch();
                        try {
                          quitClean();
                        } catch (_) {
                          app.exit(0);
                        }
                      }, 1200);
                    } catch (e) {
                      failSoft(e.message);
                    }
                  });
                } catch (e) {
                  fail(e.message);
                }
              });
            });
            res.on("error", (e) => fail(e.message));
          });
          req.on("error", (e) => fail(e.message));
          req.end();
        } catch (e) {
          sendP({ error: e.message });
          resolve({ ok: false, error: e.message });
        }
      }),
  );
  const IP_PROVIDERS = [
    {
      url: "https://check-host.net/ip/widget.js",
      raw: true,
      parse: (text) => {
        const ip = (text.match(/masked0">([\d.:a-fA-F]+)<\/span>/) || [])[1];
        const code = (text.match(/flags2\/([a-z]{2})\.svg" alt="\1"/) || [])[1];
        const full = (text.match(/masked0">([^<]+)<\/span>\s*<\/span>/) || [])[1];
        if (!ip || !full) return null;
        const m = full.match(/^([^(]+)\(([^,)]+)(?:,\s*([^)]+))?\)$/);
        const country = m ? m[1].trim() : full.trim();
        const city = m ? (m[3] || m[2] || "").trim() : "";
        return { ip: ip, country: country, code: (code || "").toLowerCase(), city: city };
      },
    },
    {
      url: "https://ipwho.is/",
      parse: (j) => ({
        ip: j.ip,
        country: j.country,
        code: (j.country_code || "").toLowerCase(),
        city: j.city,
      }),
    },
    {
      url: "http://ip-api.com/json/",
      parse: (j) => ({
        ip: j.query,
        country: j.country,
        code: (j.countryCode || "").toLowerCase(),
        city: j.city,
      }),
    },
    {
      url: "https://ipapi.co/json/",
      parse: (j) => ({
        ip: j.ip,
        country: j.country_name,
        code: (j.country_code || "").toLowerCase(),
        city: j.city,
      }),
    },
  ];
  function fetchIpFrom(provider, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      try {
        const req = net.request({
          url: provider.url + (provider.url.includes("?") ? "&" : "?") + "_=" + Date.now(),
          useSessionCookies: false,
        });
        let d = "";
        req.on("response", (res) => {
          res.on("data", (c) => (d += c));
          res.on("end", () => {
            try {
              const r = provider.raw ? provider.parse(d) : provider.parse(JSON.parse(d));
              fin(r && r.ip ? r : null);
            } catch (_) {
              fin(null);
            }
          });
          res.on("error", () => fin(null));
        });
        req.on("error", () => fin(null));
        req.on("abort", () => fin(null));
        req.setHeader("User-Agent", "SnowVPN");
        req.setHeader("Cache-Control", "no-cache");
        req.end();
        setTimeout(() => fin(null), timeoutMs);
      } catch (_) {
        fin(null);
      }
    });
  }
  async function fetchPublicIp() {
    for (const p of IP_PROVIDERS) {
      const r = await fetchIpFrom(p, 5e3);
      if (r) return r;
    }
    return null;
  }
  ipcMain.handle("app:publicIp", async () => {
    if (!state.running) return { masked: true };
    const r = await fetchPublicIp();
    return r || null;
  });
  const psRun = (cmd, timeout = 8e3) =>
    new Promise((resolve) => {
      try {
        const { execFile: execFile } = require("child_process");
        const p = execFile(
          "powershell",
          ["-NoProfile", "-NonInteractive", "-Command", cmd],
          { windowsHide: true, timeout: timeout },
          (err, out) => resolve({ ok: !err, out: String(out || "").trim() }),
        );
        p.on("error", () => resolve({ ok: false, out: "" }));
      } catch (_) {
        resolve({ ok: false, out: "" });
      }
    });
  const dnsLookup = (host, timeout = 5e3) =>
    new Promise((resolve) => {
      let done = false;
      const fin = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      setTimeout(() => fin(null), timeout);
      try {
        require("dns").lookup(host, (err, addr) => fin(err ? null : addr));
      } catch (_) {
        fin(null);
      }
    });
  let selfCheckRunning = false;
  ipcMain.handle("diag:selfcheck", async () => {
    if (selfCheckRunning) return { running: true };
    selfCheckRunning = true;
    const steps = [];
    const report = (s) => {
      steps.push(s);
      send("diag:step", s);
    };
    try {
      let coreOk = false;
      try {
        await ensureCore();
        coreOk = !!(bridge && bridge.isAlive() && bridge.isInit);
      } catch (_) {}
      report(
        coreOk
          ? {
              id: "core",
              title: "Ядро VPN",
              status: "ok",
              detail: "SnowVPNCore запущено и отвечает",
            }
          : {
              id: "core",
              title: "Ядро VPN",
              status: "fail",
              detail: "Ядро не запускается или не отвечает",
              hint: "Чаще всего ядро блокирует антивирус — добавьте папку SnowVPN в исключения и перезапустите приложение. Если не поможет — переустановите клиент.",
            },
      );
      const admin = isAdmin();
      if (state.netMode === "tun") {
        report(
          admin
            ? {
                id: "admin",
                title: "Права администратора",
                status: "ok",
                detail: "Запущено с правами администратора",
              }
            : {
                id: "admin",
                title: "Права администратора",
                status: "fail",
                detail: "Режим TUN требует прав администратора",
                hint: "Нажмите «Подключить» — приложение само предложит перезапуск от администратора. Либо включите в Настройках «Всегда запускать от администратора».",
              },
        );
      } else {
        report({
          id: "admin",
          title: "Права администратора",
          status: "ok",
          detail: "Для режима «Прокси» не требуются",
        });
      }
      const sub = subById(state.activeSub);
      const profOk = state.activeSub && fs.existsSync(profilePath(state.activeSub));
      if (!sub || !profOk) {
        report({
          id: "sub",
          title: "Подписка",
          status: "fail",
          detail: sub ? "Файл профиля подписки отсутствует" : "Подписка не добавлена",
          hint: sub
            ? "Откройте «Подписки» и нажмите ⟳ (обновить) у вашей подписки."
            : "Добавьте подписку: скопируйте ссылку из личного кабинета и вставьте на экране «Подписки».",
        });
      } else {
        const expSec = (sub.userinfo && sub.userinfo.expire) || 0;
        const exp = expSec ? expSec * (expSec < 1e12 ? 1e3 : 1) : 0;
        const expired = exp && exp < Date.now();
        report(
          expired
            ? {
                id: "sub",
                title: "Подписка",
                status: "fail",
                detail: "«" + (sub.name || "Подписка") + "» истекла",
                hint: "Продлите подписку в личном кабинете, затем обновите её на экране «Подписки» (⟳).",
              }
            : {
                id: "sub",
                title: "Подписка",
                status: "ok",
                detail: "«" + (sub.name || "Подписка") + "» активна",
              },
        );
      }
      if (!state.running) {
        const ksStuck = killSwitch.isEngaged();
        report({
          id: "vpn",
          title: "Подключение",
          status: "fail",
          detail: "VPN сейчас не подключён",
          hint: ksStuck
            ? "Kill Switch активен при отключённом VPN — интернет заблокирован намеренно. Подключитесь или выключите Kill Switch в Настройках."
            : "Нажмите большую кнопку подключения на главном экране. Проверки ниже выполняются только при подключённом VPN.",
        });
        ["net", "dns", "srv", "inet", "ip"].forEach((id) =>
          report({ id: id, title: "", status: "skip" }),
        );
        return { steps: steps, done: true };
      }
      report({
        id: "vpn",
        title: "Подключение",
        status: "ok",
        detail:
          "VPN подключён (" +
          (state.netMode === "tun" ? "TUN" : "Прокси") +
          " · " +
          (state.routeMode === "rule" ? "по приложениям" : "весь ПК") +
          ")",
      });
      if (state.netMode === "tun") {
        let up = false;
        if (process.platform === "darwin") {
          try {
            const ifconfig = execSync("ifconfig", { encoding: "utf8" });
            up = /utun\d+:\s+flags=/i.test(ifconfig);
          } catch (_) {}
        } else {
          const r = await psRun(
            `(Get-NetAdapter -Name '${TUN_DEVICE.replace(/'/g, "''")}' -ErrorAction SilentlyContinue).Status`,
          );
          up = r.ok && /Up/i.test(r.out);
        }
        report(
          up
            ? {
                id: "net",
                title: "TUN-адаптер",
                status: "ok",
                detail: process.platform === "darwin" ? "TUN-интерфейс (utun) поднят" : "Адаптер «" + TUN_DEVICE + "» поднят",
              }
            : {
                id: "net",
                title: "TUN-адаптер",
                status: "fail",
                detail: "Адаптер не найден или не поднят",
                hint: process.platform === "darwin"
                  ? "Для работы TUN на macOS требуются права суперпользователя: выполните 'sudo chmod u+s core/SnowVPNCore' и переподключитесь."
                  : "Отключитесь и подключитесь заново. Если повторяется — перезагрузите компьютер (застрявший драйвер wintun) и проверьте, что антивирус не блокирует создание сетевых адаптеров.",
              },
        );
      } else {
        let on = false;
        if (process.platform === "darwin") {
          try {
            const out = execSync("networksetup -getwebproxy Wi-Fi", { encoding: "utf8" });
            on = /Enabled:\s+Yes/i.test(out);
          } catch (_) {
            on = true;
          }
        } else {
          const r = await psRun(
            "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings').ProxyEnable",
          );
          on = r.ok && r.out.trim() === "1";
        }
        report(
          on
            ? {
                id: "net",
                title: "Системный прокси",
                status: "ok",
                detail: "Прокси включён (127.0.0.1:" + MIXED_PORT + ")",
              }
            : {
                id: "net",
                title: "Системный прокси",
                status: "fail",
                detail: "Системный прокси выключен",
                hint: "Другая программа (антивирус, «оптимизатор») сбросила настройки прокси. Отключитесь и подключитесь заново.",
              },
        );
      }
      const addr = await dnsLookup("www.gstatic.com");
      report(
        addr
          ? {
              id: "dns",
              title: "DNS",
              status: "ok",
              detail: "Домены резолвятся (gstatic → " + addr + ")",
            }
          : {
              id: "dns",
              title: "DNS",
              status: "fail",
              detail: "Домены не резолвятся",
              hint: "Попробуйте сменить DNS в Настройках (например, на Cloudflare) и переподключиться. Если у вас включён «Безопасный DNS» в браузере или антивирусе — отключите его.",
            },
      );
      const cur = state.currentServer;
      const na = cur && nodeAddrs[cur];
      if (na && na.server && na.port) {
        const ms = await tcpPing(na.server, na.port, 6e3);
        report(
          ms >= 0
            ? {
                id: "srv",
                title: "Сервер",
                status: "ok",
                detail: cleanSrvName(cur) + " отвечает (" + ms + " мс)",
              }
            : {
                id: "srv",
                title: "Сервер",
                status: "fail",
                detail: cleanSrvName(cur) + " не отвечает",
                hint: "Похоже, выбранный сервер сейчас недоступен или заблокирован вашим провайдером. Выберите другой сервер из списка.",
              },
        );
      } else {
        report({
          id: "srv",
          title: "Сервер",
          status: "warn",
          detail: "Не удалось определить адрес выбранного сервера",
          hint: "Выберите сервер на экране «Серверы».",
        });
      }
      const inet = await checkConnectivity();
      report(
        inet
          ? {
              id: "inet",
              title: "Интернет через VPN",
              status: "ok",
              detail: "Трафик проходит через туннель",
            }
          : {
              id: "inet",
              title: "Интернет через VPN",
              status: "fail",
              detail: "Трафик не проходит",
              hint: "Туннель поднят, но данные не идут. Смените сервер; если не помогло — переключите режим сети (TUN ↔ Прокси) в Настройках и переподключитесь.",
            },
      );
      const ip = await fetchPublicIp();
      report(
        ip && ip.ip
          ? {
              id: "ip",
              title: "Внешний IP",
              status: "ok",
              detail: ip.ip + (ip.country ? " · " + ip.country : ""),
            }
          : {
              id: "ip",
              title: "Внешний IP",
              status: "warn",
              detail: "Не удалось определить (сервисы проверки IP не ответили)",
              hint: "Само по себе не страшно, если предыдущие проверки зелёные.",
            },
      );
      return { steps: steps, done: true };
    } finally {
      selfCheckRunning = false;
    }
  });
}
function registerHotkey() {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  if (settings.hotkeyEnabled && settings.hotkey) {
    try {
      globalShortcut.register(settings.hotkey, async () => {
        try {
          if (state.running) await disconnect();
          else await connect();
        } catch (e) {
          send("vpn:state", state);
        }
      });
    } catch (_) {}
    try {
      globalShortcut.register(settings.hotkeyNext || "Ctrl+Alt+N", () => {
        nextServer();
      });
    } catch (_) {}
  }
}
let trafficTimer = null,
  lastTotUp = 0,
  lastTotDown = 0,
  statsTick = 0,
  lastSession = { up: 0, down: 0 };
let emaUp = 0,
  emaDown = 0;
function smooth(prev, cur) {
  const a = 0.5;
  return prev * (1 - a) + cur * a;
}
function todayKey() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
function accumulateTraffic(totUp, totDown) {
  settings.trafficStats = settings.trafficStats || {};
  let du = totUp - lastTotUp,
    dd = totDown - lastTotDown;
  if (du < 0) du = totUp;
  if (dd < 0) dd = totDown;
  const k = todayKey();
  const e = settings.trafficStats[k] || { up: 0, down: 0 };
  e.up += Math.max(0, du);
  e.down += Math.max(0, dd);
  settings.trafficStats[k] = e;
  lastTotUp = totUp;
  lastTotDown = totDown;
  const keys = Object.keys(settings.trafficStats).sort();
  if (keys.length > 60)
    keys.slice(0, keys.length - 60).forEach((kk) => delete settings.trafficStats[kk]);
}
function startTrafficPump() {
  if (trafficTimer) return;
  trafficTimer = setInterval(async () => {
    if (!bridge || !bridge.isInit || !state.running) {
      lastTotUp = 0;
      lastTotDown = 0;
      emaUp = 0;
      emaDown = 0;
      return;
    }
    try {
      const tt = await bridge.getTotalTraffic();
      const tot = typeof tt === "string" ? JSON.parse(tt) : tt;
      const tu = tot.up || 0,
        td = tot.down || 0;
      accumulateTraffic(tu, td);
      lastSession = { up: tu, down: td };
      if (++statsTick % 30 === 0) {
        try {
          saveSettings();
        } catch (_) {}
      }
      if ((win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) || miniVisible()) {
        const t = await bridge.getTraffic();
        const tr = typeof t === "string" ? JSON.parse(t) : t;
        emaUp = smooth(emaUp, tr.up || 0);
        emaDown = smooth(emaDown, tr.down || 0);
        send("vpn:traffic", { up: emaUp, down: emaDown, totalUp: tu, totalDown: td });
      } else {
        emaUp = 0;
        emaDown = 0;
      }
    } catch (_) {}
  }, 1e3);
}
app.whenReady().then(async () => {
  diag(
    "=== ЗАПУСК === SnowVPN " +
      CLIENT_VERSION +
      (SAFE_MODE ? " [ЩАДЯЩИЙ РЕЖИМ]" : "") +
      (deadStarts ? " [незавершённых стартов до этого: " + deadStarts + "]" : "") +
      " | Windows " +
      os.release() +
      " " +
      process.arch +
      " | Electron " +
      process.versions.electron +
      " | exe=" +
      process.execPath +
      " | admin=" +
      (function () {
        try {
          return isAdmin();
        } catch (e) {
          return "?";
        }
      })() +
      " | правил=" +
      (settings.rules || []).length +
      " подписок=" +
      (settings.subs || []).length +
      " | настройки=" +
      SETTINGS_PATH,
  );
  try {
    const pend = settings.pendingUpdateExe;
    if (pend && fs.existsSync(pend)) {
      diag("pending update -> installing " + pend);
      settings.pendingUpdateExe = null;
      saveSettings({ allowShrink: true });
      runInstaller(pend);
      return;
    }
    if (pend) {
      settings.pendingUpdateExe = null;
      saveSettings({ allowShrink: true });
    }
  } catch (_) {}
  autostartCleanLegacy();
  try {
    const kr = await Promise.race([ksCleanup(), new Promise((r) => setTimeout(r, 2e3))]);
    if (settings.ksActive && !(kr && kr.ok) && !isAdmin()) {
      setTimeout(
        () =>
          notify(
            "SnowVPN — интернет может быть заблокирован",
            "Kill Switch не снят с прошлого сеанса, нужны права администратора. Перезапустите SnowVPN от имени администратора.",
          ),
        3500,
      );
    }
  } catch (_) {}
  try {
    if (isAdmin()) killSwitch.ensureAllowed(CORE_EXE, process.execPath).catch(() => {});
  } catch (_) {}
  try {
    if (settings.alwaysAdmin && !getAlwaysAdmin()) {
      setAlwaysAdmin(true);
      diag("admin flag re-applied for " + process.execPath);
    }
  } catch (_) {}
  try {
    if (isAdmin()) {
      clearAdminRetries();
    } else if (settings.alwaysAdmin) {
      const tries = loadAdminRetries() + 1;
      if (tries > ADMIN_RETRY_LIMIT) {
        diag(
          "alwaysAdmin: " +
            (tries - 1) +
            " попыток подряд без прав → снимаю флаг, открываюсь без админа",
        );
        settings.alwaysAdmin = false;
        try {
          saveSettings();
        } catch (_) {}
        try {
          setAlwaysAdmin(false);
        } catch (_) {}
        clearAdminRetries();
        setTimeout(
          () =>
            notify(
              "SnowVPN — запуск без прав администратора",
              "Не удалось получить права (UAC не подтверждён). Настройка «Всегда от администратора» выключена, чтобы приложение открывалось. Режим TUN потребует запуска от администратора вручную.",
            ),
          3e3,
        );
      } else {
        saveAdminRetries(tries);
        diag(
          "alwaysAdmin set but not elevated → relaunch as admin (попытка " +
            tries +
            "/" +
            ADMIN_RETRY_LIMIT +
            ")",
        );
        if (relaunchAdmin()) return;
        clearAdminRetries();
      }
    }
  } catch (_) {}
  ensureDirs();
  registerIpc();
  createWindow();
  setupTray();
  registerHotkey();
  startTrafficPump();
  startLiveness();
  startSubAutoUpdate();
  refreshSubHosts();
  setTimeout(() => {
    if (isQuitting || winEverShown) return;
    if (settings.startMinimized || process.argv.includes("--tray")) return;
    diag(
      "СТОРОЖ: окно не показалось за 15 с (окно создано=" +
        (!!win && !win.isDestroyed()) +
        ") → пробую показать",
    );
    try {
      notify(
        "SnowVPN запущен, но окно не открылось",
        "Пробуем открыть его сейчас. Если окно так и не появится — нажмите на значок SnowVPN у часов или переустановите приложение с сайта.",
      );
    } catch (_) {}
    try {
      showWindow();
    } catch (_) {}
  }, 15e3);
  setTimeout(() => {
    maybeAskAdmin();
  }, 1600);
  try {
    await new Promise((resolve) => {
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", resolve);
      else resolve();
    });
    await handleDeepLinkArgv(process.argv);
  } catch (_) {}
  ensureCore()
    .then(async () => {
      try {
        if (state.activeSub) {
          await updateSub(state.activeSub);
          send("sub:changed");
        } else await applyActive();
      } catch (e) {
        try {
          await applyActive();
        } catch (_) {}
      }
      try {
        const s = subById(state.activeSub);
        if (s) checkSubExpiry(s);
      } catch (_) {}
      if (settings.autoConnect && state.activeSub && !state.running) {
        try {
          await connect();
          send("vpn:state", state);
        } catch (e) {
          console.log("autoConnect", e.message);
        }
      }
      rebuildProfilesOnce()
        .then((n) => {
          if (n) send("sub:changed");
        })
        .catch(() => {});
    })
    .catch((e) => console.log("core warmup", e.message));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("before-quit", () => {
  isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  try {
    if (bridge) {
      bridge.stop();
    }
  } catch (_) {}
  forceKillAll();
});
app.on("will-quit", () => {
  forceKillAll();
});
app.on("window-all-closed", () => {});
