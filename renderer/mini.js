"use strict";
(function () {
  var api = window.snow || {};
  function $(id) {
    return document.getElementById(id);
  }
  function cleanName(n) {
    return String(n || "")
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  var connected = false,
    transient = false,
    busy = false;
  var STATUS = {
    connecting: "подключение…",
    connected: "защищено",
    reconnecting: "переподключение…",
    disconnecting: "отключение…",
    disconnected: "офлайн",
  };
  function applyState(st) {
    var status = (st && st.status) || (st && st.running ? "connected" : "disconnected");
    connected = status === "connected";
    transient = status === "connecting" || status === "reconnecting" || status === "disconnecting";
    $("mDot").className = "dot" + (connected ? " on" : transient ? " busy" : "");
    $("mPwr").className = "pwr" + (connected ? " on" : "") + (transient ? " busy" : "");
    $("mStatus").textContent = STATUS[status] || "офлайн";
    if (st && st.currentServer) $("mSrv").textContent = cleanName(st.currentServer);
    if (!connected) {
      $("mDl").textContent = "0.0";
      $("mUl").textContent = "0.0";
    }
  }
  if (api.getSettings)
    api
      .getSettings()
      .then(function (s) {
        try {
          if (s && s.accent && s.accent.c)
            document.documentElement.style.setProperty("--cy", s.accent.c);
          if (s && s.accent && s.accent.g)
            document.documentElement.style.setProperty("--grad", s.accent.g);
        } catch (_) {}
      })
      .catch(function () {});
  if (api.getState)
    api
      .getState()
      .then(applyState)
      .catch(function () {});
  if (api.onState) api.onState(applyState);
  if (api.onTraffic)
    api.onTraffic(function (tr) {
      $("mDl").textContent = (((tr.down || 0) * 8) / 1e6).toFixed(1);
      $("mUl").textContent = (((tr.up || 0) * 8) / 1e6).toFixed(1);
    });
  $("mPwr").onclick = async function () {
    if (busy) return;
    busy = true;
    var wantOff = connected || transient;
    $("mStatus").textContent = wantOff ? "отключение…" : "подключение…";
    $("mPwr").classList.add("busy");
    try {
      var r = wantOff ? await api.disconnect() : await api.connect();
      if (r && !r.ok) {
        if (r.needAdmin) {
          api.miniClose && api.miniClose(true);
        } else $("mStatus").textContent = "ошибка — откройте клиент";
      }
    } catch (_) {
      $("mStatus").textContent = "ошибка";
    }
    $("mPwr").classList.remove("busy");
    busy = false;
  };
  $("mExpand").onclick = function () {
    if (api.miniClose) api.miniClose(true);
  };
})();
