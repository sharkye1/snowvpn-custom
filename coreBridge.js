"use strict";
const net = require("net");
const fs = require("fs");
const { spawn: spawn } = require("child_process");
const { EventEmitter: EventEmitter } = require("events");
const crypto = require("crypto");
async function probeDelayWithRetry(testOnce, attempts = 2) {
  let lastResult = null;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await testOnce(attempt);
      const result = typeof raw === "string" ? JSON.parse(raw) : raw;
      lastResult = result;
      if (result && Number(result.value) > 0) return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResult) return lastResult;
  throw lastError || new Error("проверка задержки не вернула результат");
}
async function refineDelay(first, measureAgain, outlierMs = 250) {
  if (!first || !(Number(first.value) > outlierMs)) return first;
  try {
    const raw = await measureAgain();
    const again = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (again && Number(again.value) > 0 && Number(again.value) < Number(first.value)) return again;
  } catch (_) {}
  return first;
}
class CoreBridge extends EventEmitter {
  constructor(opts) {
    super();
    this.coreExe = opts.coreExe;
    this.coreDir = opts.coreDir;
    this.homeDir = opts.homeDir;
    this.version = opts.version || 20;
    this.onLog = opts.onLog || null;
    this.server = null;
    this.socket = null;
    this.proc = null;
    this.buffer = "";
    this.pending = new Map();
    this.starting = null;
    this.isInit = false;
  }
  log(...a) {
    const s = a.map((x) => (typeof x === "string" ? x : String(x))).join(" ");
    console.log("[core]", s);
    try {
      if (this.onLog) this.onLog("[ядро] " + s);
    } catch (_) {}
  }
  isAlive() {
    return !!this.socket && !!this.proc;
  }
  _flushPending(reason) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      try {
        p.reject(new Error(reason));
      } catch (_) {}
    }
    this.pending.clear();
  }
  start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (settled) return;
        settled = true;
        clearTimeout(tmr);
        resolve();
      };
      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(tmr);
        this.starting = null;
        reject(e);
      };
      const tmr = setTimeout(
        () =>
          fail(
            new Error("ядро не подключилось за 20 секунд (антивирус? отсутствует VC++ Runtime?)"),
          ),
        2e4,
      );
      this._startFail = fail;
      this.server = net.createServer((socket) => {
        if (this.socket) {
          this.log("лишнее подключение отклонено");
          try {
            socket.destroy();
          } catch (_) {}
          return;
        }
        this.log("ядро подключилось");
        this.socket = socket;
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => this._onData(chunk));
        socket.on("error", (e) => this.log("socket error", e.message));
        socket.on("close", () => {
          this.log("socket закрыт");
          if (this.socket === socket) this.socket = null;
          this._flushPending("соединение с ядром потеряно");
        });
        this.emit("connected");
        ok();
      });
      this.server.on("error", fail);
      this.server.listen(0, "127.0.0.1", () => {
        const port = this.server.address().port;
        this.log("слушаю порт", port, "→ запускаю ядро");
        this._spawnCore(port);
      });
    });
    return this.starting;
  }
  _spawnCore(port) {
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(this.coreExe, 0o755);
      } catch (_) {}
    }
    const env = Object.assign({}, process.env, { SAFE_PATHS: `${this.homeDir};${this.coreDir}` });
    this.proc = spawn(this.coreExe, [String(port)], {
      cwd: this.coreDir,
      env: env,
      windowsHide: true,
    });
    this.proc.on("error", (e) => {
      this.log("spawn error", e.message);
      this.proc = null;
      if (this._startFail) this._startFail(new Error("не удалось запустить ядро: " + e.message));
      this.emit("core-exit", -1);
    });
    this.proc.stdout.on("data", (d) => {
      const s = d.toString().trim();
      if (s) this.log("STDOUT", s);
    });
    this.proc.stderr.on("data", (d) => {
      const s = d.toString().trim();
      if (s) this.log("STDERR", s);
    });
    this.proc.on("exit", (code) => {
      this.log("ядро вышло, код", code);
      this.proc = null;
      if (this._startFail)
        this._startFail(new Error("ядро завершилось сразу после запуска, код " + code));
      this.emit("core-exit", code);
    });
  }
  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        this.log("bad json", line.slice(0, 120));
        continue;
      }
      this._handle(msg);
    }
  }
  _handle(msg) {
    if (msg.method === "message") {
      this.emit("message", msg.data);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.code === -1)
      p.reject(new Error(typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data)));
    else p.resolve(msg.data);
  }
  invoke(method, data, timeoutMs = 15e3) {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("ядро не подключено"));
      const id = `${method}#${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`таймаут ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        this.socket.write(JSON.stringify({ id: id, method: method, data: data }) + "\n");
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  async init() {
    const r = await this.invoke(
      "initClash",
      JSON.stringify({ "home-dir": this.homeDir, version: this.version }),
    );
    this.isInit = !!r;
    return this.isInit;
  }
  getIsInit() {
    return this.invoke("getIsInit");
  }
  setupConfig(config, selectedMap = {}, testUrl = "https://www.gstatic.com/generate_204") {
    return this.invoke(
      "setupConfig",
      JSON.stringify({ config: config, "selected-map": selectedMap, "test-url": testUrl }),
      12e4,
    );
  }
  updateConfig(params) {
    return this.invoke("updateConfig", JSON.stringify(params), 12e4);
  }
  getConfigFromFile(path) {
    return this.invoke("getConfig", path, 12e4);
  }
  validateConfig(yaml) {
    return this.invoke("validateConfig", yaml);
  }
  getProxies() {
    return this.invoke("getProxies", undefined, 8e3);
  }
  changeProxy(groupName, proxyName) {
    return this.invoke(
      "changeProxy",
      JSON.stringify({ "group-name": groupName, "proxy-name": proxyName }),
    );
  }
  getTraffic() {
    return this.invoke("getTraffic");
  }
  getTotalTraffic() {
    return this.invoke("getTotalTraffic");
  }
  getConnections() {
    return this.invoke("getConnections");
  }
  closeConnections() {
    return this.invoke("closeConnections");
  }
  getMemory() {
    return this.invoke("getMemory");
  }
  testDelay(proxyName, testUrl = "https://www.gstatic.com/generate_204", timeout = 5e3) {
    return this.invoke(
      "asyncTestDelay",
      JSON.stringify({ "proxy-name": proxyName, "test-url": testUrl, timeout: timeout }),
      timeout + 3e3,
    );
  }
  testDelayReliable(
    proxyName,
    testUrls = ["https://www.gstatic.com/generate_204", "https://cp.cloudflare.com/generate_204"],
    timeouts = [1e4, 8e3],
  ) {
    const urls = (Array.isArray(testUrls) ? testUrls : [testUrls]).filter(Boolean);
    const limits = (Array.isArray(timeouts) ? timeouts : [timeouts]).filter(
      (value) => Number(value) > 0,
    );
    const attempts = Math.max(urls.length, limits.length, 1);
    return probeDelayWithRetry(
      (attempt) =>
        this.testDelay(
          proxyName,
          urls[attempt] || urls[urls.length - 1] || "https://www.gstatic.com/generate_204",
          limits[attempt] || limits[limits.length - 1] || 5e3,
        ),
      attempts,
    );
  }
  async testDelayStable(proxyName, testUrls, timeouts) {
    const first = await this.testDelayReliable(proxyName, testUrls, timeouts);
    const url =
      (Array.isArray(testUrls) ? testUrls[0] : testUrls) || "https://www.gstatic.com/generate_204";
    const limit = (Array.isArray(timeouts) ? timeouts[0] : timeouts) || 1e4;
    return refineDelay(first, () => this.testDelay(proxyName, url, limit));
  }
  startListener() {
    return this.invoke("startListener", undefined, 6e4);
  }
  stopListener() {
    return this.invoke("stopListener");
  }
  stopTun() {
    return this.invoke("stopTun");
  }
  startLog() {
    return this.invoke("startLog");
  }
  stopLog() {
    return this.invoke("stopLog");
  }
  shutdown() {
    return this.invoke("shutdown", undefined, 2e3).catch(() => {});
  }
  async stop() {
    try {
      await this.shutdown();
    } catch (_) {}
    this._flushPending("мост остановлен");
    if (this.proc) {
      try {
        this.proc.removeAllListeners("exit");
        this.proc.kill();
      } catch (_) {}
      this.proc = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (_) {}
      this.socket = null;
    }
    if (this.server) {
      try {
        this.server.close();
      } catch (_) {}
      this.server = null;
    }
    this.starting = null;
    this.isInit = false;
  }
}
module.exports = {
  CoreBridge: CoreBridge,
  probeDelayWithRetry: probeDelayWithRetry,
  refineDelay: refineDelay,
};
