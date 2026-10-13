(function () {
  var win = document.getElementById("win"),
    root = document.documentElement,
    body = document.body;
  var api = window.snow || {};
  window.onerror = function (m, s, l) {
    try {
      api.diag &&
        api.diag(
          "JS-ERR: " +
            m +
            " @" +
            String(s || "")
              .split("/")
              .pop() +
            ":" +
            l,
        );
    } catch (_) {}
  };
  try {
    api.diag && api.diag("renderer start, api methods=" + Object.keys(api).length);
  } catch (_) {}
  function $(id) {
    return document.getElementById(id);
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(function () {
      t.classList.remove("show");
    }, 2800);
  }
  var _escEl = document.createElement("span");
  function esc(t) {
    _escEl.textContent = t == null ? "" : String(t);
    return _escEl.innerHTML;
  }
  if (api.minimize) {
    $("wMin").onclick = api.minimize;
    $("wMax").onclick = api.maximize;
    $("wClose").onclick = api.close;
  }
  if ($("wMini") && api.miniOpen)
    $("wMini").onclick = function () {
      api.miniOpen();
    };
  function go(s) {
    document.querySelectorAll(".nav").forEach(function (n) {
      n.classList.toggle("on", n.dataset.s === s);
    });
    document.querySelectorAll(".scr").forEach(function (sc) {
      sc.classList.toggle("on", sc.dataset.screen === s);
    });
    if (s !== "connections" && typeof connTimer !== "undefined") clearInterval(connTimer);
    if (s === "srv") loadServers();
    if (s === "subs") loadSub();
  }
  document.querySelectorAll(".nav").forEach(function (n) {
    n.onclick = function () {
      go(n.dataset.s);
    };
  });
  document.querySelectorAll("[data-go]").forEach(function (c) {
    c.onclick = function () {
      go(c.dataset.go);
    };
  });
  var connected = false,
    busy = false,
    transient = false,
    timer = null,
    sessStart = 0;
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function fmtDur(sec) {
    if (sec < 0) sec = 0;
    var h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
  }
  function tickTimer() {
    if (sessStart) {
      var t = fmtDur(Math.floor((Date.now() - sessStart) / 1e3));
      $("tmr").textContent = t;
      if ($("uptimeOnly")) $("uptimeOnly").textContent = t;
    }
  }
  function setSession(run, startTs) {
    clearInterval(timer);
    if (run) {
      sessStart = startTs || sessStart || Date.now();
      tickTimer();
      timer = setInterval(tickTimer, 1e3);
    } else {
      sessStart = 0;
      $("tmr").textContent = "00:00";
      $("dl").textContent = "0.0";
      $("ul").textContent = "0.0";
      ["uptimeOnly:00:00", "dlOnly:0.0", "ulOnly:0.0", "pingVal:—", "hsrvPingVal:— мс"].forEach(
        function (p) {
          var a = p.split(":");
          if ($(a[0])) $(a[0]).textContent = a[1];
        },
      );
    }
  }
  function applyState(st) {
    var status = (st && st.status) || (st && st.running ? "connected" : "disconnected");
    connected = status === "connected";
    transient = status === "connecting" || status === "reconnecting" || status === "disconnecting";
    win.classList.toggle("conn", connected);
    win.classList.toggle("busy", transient);
    $("pl").textContent =
      status === "disconnecting"
        ? "Отключаю…"
        : connected || transient
          ? "Отключить"
          : "Подключить";
    var S1 = {
      connecting: "Подключение…",
      connected: "Защищено",
      reconnecting: "Переподключение…",
      disconnecting: "Отключение…",
      disconnected: "Не защищено",
    };
    var S2 = {
      connecting: "Устанавливаю соединение",
      connected: "Трафик идёт через VPN",
      reconnecting: "Связь прервалась — восстанавливаю",
      disconnecting: "Разрываю соединение",
      disconnected: "Нажмите, чтобы включить защиту",
    };
    $("s1").textContent = S1[status] || "Не защищено";
    $("s2").textContent = S2[status] || "";
    $("stName").textContent = connected ? "онлайн" : transient ? "переподключение…" : "офлайн";
    $("stDot").classList.toggle("on", connected);
    if (st && st.netMode) {
      $("stMode").textContent = st.netMode === "tun" ? "TUN" : "Прокси";
      $("tunSw").classList.toggle("on", st.netMode === "tun");
      $("proxySw").classList.toggle("on", st.netMode === "proxy");
    }
    if (st && st.proxyHostPort && $("proxyAddr")) $("proxyAddr").textContent = st.proxyHostPort;
    if (st && st.routeMode) syncRoute(st.routeMode);
    if (st) updateQuick(st);
    setSession(connected, st && st.connectedAt);
    if (st && st.currentServer) {
      curServerRaw = st.currentServer;
      $("hsrv").textContent = cleanName(st.currentServer);
      setSrvFlag(st.currentServer);
    }
    if (lastRunning !== connected) {
      lastRunning = connected;
      lastServer = (st && st.currentServer) || lastServer;
      $("ipVal").textContent = "обновляю…";
      clearTimeout(ipTimer);
      ipTimer = setTimeout(refreshIp, connected ? 2200 : 1500);
    } else if (connected && st && st.currentServer && st.currentServer !== lastServer) {
      lastServer = st.currentServer;
      $("ipVal").textContent = "обновляю…";
      clearTimeout(ipTimer);
      ipTimer = setTimeout(refreshIp, 1500);
    }
  }
  var lastRunning = null,
    ipTimer = null,
    lastServer = null,
    curServerRaw = null;
  function widgetVisible(id) {
    var el = document.querySelector('.widget[data-w="' + id + '"]');
    return el && el.style.display !== "none" && el.offsetParent;
  }
  var pingBusy = false;
  function setPingUi(d) {
    var txt = d > 0 ? d + " мс" : "таймаут";
    var color = d < 0 ? "#ff7a7a" : d < 100 ? "#43e08a" : d < 250 ? "#ffc266" : "#ff7a7a";
    if ($("pingVal")) {
      $("pingVal").textContent = txt;
      $("pingVal").style.color = color;
    }
    if ($("hsrvPingVal")) {
      $("hsrvPingVal").textContent = txt;
      $("hsrvPingVal").style.color = color;
    }
  }
  async function pollPing() {
    if (!api.testDelay || pingBusy) return;
    if (document.hidden) return;
    if (
      !widgetVisible("ping") &&
      !(document.querySelector('.scr[data-screen="home"]') || {}).classList.contains("on")
    )
      return;
    var name = curServerRaw || $("hsrv").textContent;
    if (!name) return;
    pingBusy = true;
    try {
      var r = await api.testDelay(name, { method: "http" });
      if (name === (curServerRaw || $("hsrv").textContent)) setPingUi(r && r.ok ? r.delay : -1);
    } catch (_) {}
    pingBusy = false;
  }
  setInterval(pollPing, 1e4);
  if ($("hsrvPing"))
    $("hsrvPing").onclick = async function (e) {
      e.stopPropagation();
      if (pingBusy || !api.testDelay) return;
      var name = curServerRaw || $("hsrv").textContent;
      if (!name) return;
      pingBusy = true;
      if ($("hsrvPingVal")) {
        $("hsrvPingVal").textContent = "…";
        $("hsrvPingVal").style.color = "";
      }
      try {
        var r = await api.testDelay(name, { method: "http" });
        setPingUi(r && r.ok ? r.delay : -1);
      } catch (_) {
        setPingUi(-1);
      }
      pingBusy = false;
    };
  async function pollToday() {
    if (document.hidden) return;
    if (!api.statsGet || !$("todayVal") || !widgetVisible("today")) return;
    try {
      var s = await api.statsGet();
      if (s && s.today) {
        var b = (s.today.up || 0) + (s.today.down || 0);
        $("todayVal").textContent = fmtBytes(b);
      }
    } catch (_) {}
  }
  function fmtBytes(b) {
    b = b || 0;
    if (b < 1024) return b + " Б";
    if (b < 1048576) return (b / 1024).toFixed(0) + " КБ";
    if (b < 1073741824) return (b / 1048576).toFixed(1) + " МБ";
    return (b / 1073741824).toFixed(2) + " ГБ";
  }
  setInterval(pollToday, 15e3);
  function updateQuick(st) {
    document.querySelectorAll(".qchip").forEach(function (c) {
      if (c.dataset.q === "tun") c.classList.toggle("on", st.netMode === "tun");
      if (c.dataset.q === "proxy") c.classList.toggle("on", st.netMode === "proxy");
    });
  }
  var IP_RETRY_DELAYS = [1800, 2500, 4e3];
  async function refreshIp(attempt) {
    if (!api.publicIp) return;
    attempt = attempt || 0;
    try {
      var r = await api.publicIp();
      if (r && r.masked) {
        $("ipVal").textContent = "•••.•••.•••.•••";
        $("ipLoc").textContent = "IP скрыт · подключитесь к VPN";
        $("ipFlag").style.visibility = "hidden";
      } else if (r && r.ip) {
        $("ipVal").textContent = r.ip;
        $("ipLoc").textContent = [r.city, r.country].filter(Boolean).join(", ");
        if (r.code) {
          $("ipFlag").src = "https://flagcdn.com/w40/" + r.code + ".png";
          $("ipFlag").style.visibility = "visible";
        } else {
          $("ipFlag").style.visibility = "hidden";
        }
      } else if (connected && attempt < IP_RETRY_DELAYS.length) {
        clearTimeout(ipTimer);
        ipTimer = setTimeout(function () {
          refreshIp(attempt + 1);
        }, IP_RETRY_DELAYS[attempt]);
        $("ipVal").textContent = "обновляю…";
      } else {
        $("ipVal").textContent = "нет сети";
        $("ipLoc").textContent = "";
      }
    } catch (e) {
      if (connected && attempt < IP_RETRY_DELAYS.length) {
        clearTimeout(ipTimer);
        ipTimer = setTimeout(function () {
          refreshIp(attempt + 1);
        }, IP_RETRY_DELAYS[attempt]);
      } else $("ipVal").textContent = "—";
    }
  }
  document.querySelectorAll(".qchip").forEach(function (c) {
    c.onclick = async function () {
      var q = c.dataset.q;
      if (q === "tun") setNet("tun");
      else if (q === "proxy") setNet("proxy");
      else if (q === "ai") {
        var on = !c.classList.contains("on");
        var rr = api.aiSet ? await api.aiSet(on) : null;
        if (!rr || !rr.ok) {
          toast("AI-DNS: " + ((rr && rr.error) || "Не удалось применить настройку"));
          return;
        }
        document.querySelectorAll('.qchip[data-q="ai"]').forEach(function (x) {
          x.classList.toggle("on", on);
        });
        $("aiSw").classList.toggle("on", on);
        if ($("aiDnsRegionRow")) $("aiDnsRegionRow").style.display = on ? "" : "none";
        toast(rr.warning || (on ? "Настройка AI-DNS применена" : "AI-DNS выключен"));
      }
    };
  });
  if (api.onState) api.onState(applyState);
  var sparkData = [];
  function drawSpark() {
    var cv = $("sparkCanvas");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d"),
      W = cv.width,
      H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (sparkData.length < 2) return;
    var max = Math.max.apply(null, sparkData.concat([0.1]));
    var step = W / 59,
      cy = getComputedStyle(root).getPropertyValue("--cy").trim() || "#41f0e0";
    ctx.beginPath();
    sparkData.forEach(function (v, i) {
      var x = i * step,
        y = H - (v / max) * (H - 6) - 3;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = cy;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo((sparkData.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = cy + "22";
    ctx.fill();
  }
  if (api.onTraffic)
    api.onTraffic(function (tr) {
      var d = ((tr.down || 0) * 8) / 1e6,
        u = ((tr.up || 0) * 8) / 1e6;
      $("dl").textContent = d.toFixed(1);
      $("ul").textContent = u.toFixed(1);
      if ($("dlOnly")) $("dlOnly").textContent = d.toFixed(1);
      if ($("ulOnly")) $("ulOnly").textContent = u.toFixed(1);
      sparkData.push(d);
      if (sparkData.length > 60) sparkData.shift();
      if ($("sparkCanvas") && $("sparkCanvas").offsetParent) drawSpark();
    });
  $("power").onclick = async function () {
    if (busy) return;
    busy = true;
    this.classList.add("busy");
    var wantOff = connected || transient;
    $("s1").textContent = wantOff ? "Отключение…" : "Подключение…";
    $("s2").textContent = wantOff ? "Разрываю соединение" : "Устанавливаю соединение";
    $("pl").textContent = wantOff ? "Отключаю…" : "Подключаю…";
    try {
      var r = wantOff ? await api.disconnect() : await api.connect();
      if (r && r.ok) {
        applyState(r.state);
        toast(r.state.running ? "Подключено ✓" : "Отключено");
      } else if (r && r.needAdmin) {
        this.classList.remove("busy");
        busy = false;
        if (api.requestAdmin) {
          var ra = await api.requestAdmin();
          if (!ra.ok) toast("Без админа доступен «Системный прокси» (Настройки → Сеть)");
        }
        return;
      } else toast("Ошибка: " + ((r && r.error) || "не удалось"));
    } catch (e) {
      toast("Ошибка: " + e.message);
    }
    this.classList.remove("busy");
    busy = false;
  };
  var curRouteMode = "global";
  function syncRoute(mode) {
    curRouteMode = mode;
    var isGlobal = mode === "global";
    document.querySelectorAll("#modeCards .modecard").forEach(function (b) {
      b.classList.toggle("on", (b.dataset.m === "global") === isGlobal);
    });
    $("rulesBox").style.display = isGlobal ? "none" : "block";
    $("globalBox").style.display = isGlobal ? "block" : "none";
    $("hmode").textContent = isGlobal ? "Весь ПК через VPN" : "По приложениям";
  }
  document.querySelectorAll("#modeCards .modecard").forEach(function (b) {
    b.onclick = async function () {
      var mode = this.dataset.m === "global" ? "global" : "rule";
      syncRoute(mode);
      if (api.setRouteMode) await api.setRouteMode(mode);
    };
  });
  function delayColor(d) {
    return !d || d < 0 ? "var(--dim)" : d < 100 ? "#43e08a" : d < 250 ? "#ffc266" : "#ff7a7a";
  }
  function flagCode(name) {
    var pts = [];
    for (var i = 0; i < name.length; i++) {
      var cp = name.codePointAt(i);
      if (cp > 65535) i++;
      if (cp >= 127462 && cp <= 127487) pts.push(cp);
      if (pts.length === 2) break;
    }
    if (pts.length === 2)
      return String.fromCharCode(pts[0] - 127462 + 97) + String.fromCharCode(pts[1] - 127462 + 97);
    return null;
  }
  function cleanName(name) {
    return name
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function accentOnColor(hex) {
    hex = String(hex || "").replace("#", "");
    if (hex.length !== 6) return "#04222b";
    var r = parseInt(hex.substr(0, 2), 16),
      g = parseInt(hex.substr(2, 2), 16),
      b = parseInt(hex.substr(4, 2), 16);
    var yiq = (r * 299 + g * 587 + b * 114) / 1e3;
    return yiq >= 150 ? "#04222b" : "#ffffff";
  }
  var CN_MAP = {
    turkey: "tr",
    турция: "tr",
    germany: "de",
    frankfurt: "de",
    германия: "de",
    netherlands: "nl",
    amsterdam: "nl",
    нидерланды: "nl",
    finland: "fi",
    финляндия: "fi",
    usa: "us",
    "united states": "us",
    америка: "us",
    сша: "us",
    uk: "gb",
    "united kingdom": "gb",
    london: "gb",
    британия: "gb",
    france: "fr",
    paris: "fr",
    франция: "fr",
    poland: "pl",
    польша: "pl",
    sweden: "se",
    швеция: "se",
    lithuania: "lt",
    литва: "lt",
    latvia: "lv",
    латвия: "lv",
    estonia: "ee",
    эстония: "ee",
    japan: "jp",
    япония: "jp",
    singapore: "sg",
    сингапур: "sg",
    "hong kong": "hk",
    hongkong: "hk",
    canada: "ca",
    канада: "ca",
    russia: "ru",
    россия: "ru",
    spain: "es",
    испания: "es",
    italy: "it",
    италия: "it",
    switzerland: "ch",
    швейцария: "ch",
    austria: "at",
    австрия: "at",
    czech: "cz",
    чехия: "cz",
    ukraine: "ua",
    украина: "ua",
    kazakhstan: "kz",
    казахстан: "kz",
    emirates: "ae",
    dubai: "ae",
    оаэ: "ae",
    india: "in",
    индия: "in",
    china: "cn",
    китай: "cn",
    korea: "kr",
    корея: "kr",
    norway: "no",
    норвегия: "no",
  };
  function flagAny(name) {
    var c = flagCode(name);
    if (c) return c;
    var low = (name || "").toLowerCase();
    for (var k in CN_MAP) {
      if (low.indexOf(k) >= 0) return CN_MAP[k];
    }
    return null;
  }
  function setSrvFlag(name) {
    var el = $("hsrvFlag");
    if (!el) return;
    var code = flagAny(name || "");
    if (code) {
      el.src = "https://flagcdn.com/w40/" + code + ".png";
      el.style.display = "";
      el.onerror = function () {
        el.style.display = "none";
      };
    } else el.style.display = "none";
  }
  var curGroup = null,
    allProxies = [],
    serverNames = [],
    favorites = [];
  var loadGen = 0;
  async function loadServers() {
    if (!api.proxyGroups) return;
    var gen = ++loadGen;
    var sg = $("sgrid"),
      emp = $("srvEmpty");
    sg.innerHTML = "";
    emp.innerHTML = "";
    if (api.favList) {
      try {
        favorites = await api.favList();
      } catch (e) {}
    }
    var r = await api.proxyGroups();
    if (gen !== loadGen) return;
    var groups = (r && r.groups) || [];
    if (!groups.length) {
      emp.innerHTML =
        '<div class="empty"><i class="ti ti-cloud-off"></i><div class="et">Нет серверов</div><div class="es">Добавьте подписку, чтобы появились узлы</div><button class="tbtn pri" style="display:inline-flex;width:auto;padding:12px 20px" id="goSubs"><i class="ti ti-plus"></i>Добавить подписку</button></div>';
      var b = $("goSubs");
      if (b)
        b.onclick = function () {
          go("subs");
        };
      return;
    }
    var g =
      groups.find(function (x) {
        return x.name !== "GLOBAL";
      }) || groups[0];
    curGroup = g.name;
    allProxies = g.all || [];
    serverNames = allProxies.map(function (p) {
      return p.name;
    });
    renderServers();
    if (typeof refreshRoulette === "function") refreshRoulette();
    var initSrvName = g.now || (allProxies[0] && allProxies[0].name) || "—";
    $("hsrv").textContent = cleanName(initSrvName);
    setSrvFlag(initSrvName);
  }
  function sortedProxies() {
    var arr = allProxies.slice();
    var filter = ($("ssearch").value || "").toLowerCase();
    if (filter)
      arr = arr.filter(function (p) {
        return p.name.toLowerCase().indexOf(filter) >= 0;
      });
    var sort = $("srvSort").value;
    if (sort === "ping")
      arr.sort(function (a, b) {
        var da = a.delay > 0 ? a.delay : 1e9,
          db = b.delay > 0 ? b.delay : 1e9;
        return da - db;
      });
    else if (sort === "name")
      arr.sort(function (a, b) {
        return cleanName(a.name).localeCompare(cleanName(b.name));
      });
    function rank(p) {
      if (favorites.indexOf(p.name) >= 0) return 0;
      if (p.delay < 0) return 2;
      return 1;
    }
    arr.sort(function (a, b) {
      return rank(a) - rank(b);
    });
    return arr;
  }
  function pingCell(p) {
    return p._pinging
      ? '<span class="ld"></span>'
      : p.delay > 0
        ? p.delay + " ms"
        : p.delay < 0
          ? "таймаут"
          : "—";
  }
  var cardByName = {};
  function patchPing(p) {
    var card = cardByName[p.name];
    if (!card) return;
    var pc = card.querySelector(".ping");
    if (!pc) return;
    pc.style.color = delayColor(p.delay);
    pc.innerHTML = pingCell(p);
  }
  var CODE_RU = {
    nl: "Нидерланды",
    de: "Германия",
    fi: "Финляндия",
    se: "Швеция",
    no: "Норвегия",
    dk: "Дания",
    fr: "Франция",
    es: "Испания",
    it: "Италия",
    gb: "Великобритания",
    pl: "Польша",
    cz: "Чехия",
    ch: "Швейцария",
    at: "Австрия",
    rs: "Сербия",
    bg: "Болгария",
    hu: "Венгрия",
    ro: "Румыния",
    lt: "Литва",
    lv: "Латвия",
    ee: "Эстония",
    md: "Молдова",
    am: "Армения",
    az: "Азербайджан",
    by: "Беларусь",
    kz: "Казахстан",
    uz: "Узбекистан",
    cy: "Кипр",
    ru: "Россия",
    ua: "Украина",
    tr: "Турция",
    us: "США",
    ca: "Канада",
    br: "Бразилия",
    th: "Таиланд",
    vn: "Вьетнам",
    jp: "Япония",
    id: "Индонезия",
    sg: "Сингапур",
    hk: "Гонконг",
    au: "Австралия",
    in: "Индия",
    cn: "Китай",
    kr: "Корея",
    ae: "ОАЭ",
    il: "Израиль",
    ge: "Грузия",
    pt: "Португалия",
    gr: "Греция",
    ie: "Ирландия",
    be: "Бельгия",
    sk: "Словакия",
    si: "Словения",
    hr: "Хорватия",
    mx: "Мексика",
    ar: "Аргентина",
    za: "ЮАР",
    eg: "Египет",
    sa: "Сауд. Аравия",
  };
  function makeServerCard(p, sg, cur) {
    var isFav = favorites.indexOf(p.name) >= 0;
    var d = document.createElement("div");
    d.className = "scard" + (cleanName(p.name) === cur ? " sel" : "");
    var proto = (p.type || "") + (p.network ? " · " + p.network.toUpperCase() : "");
    d.innerHTML =
      '<div class="si"><div class="a">' +
      esc(cleanName(p.name)) +
      '</div><div class="b">' +
      esc(proto) +
      '</div></div><span class="ping" style="color:' +
      delayColor(p.delay) +
      '">' +
      pingCell(p) +
      '</span><i class="ti ti-star favstar' +
      (isFav ? " on" : "") +
      '"></i>';
    var code = flagAny(p.name);
    var icon;
    if (code) {
      icon = document.createElement("img");
      icon.className = "flag";
      icon.src = "https://flagcdn.com/w40/" + code + ".png";
      icon.onerror = function () {
        var c = document.createElement("div");
        c.className = "cc";
        c.innerHTML = '<i class="ti ti-server-2"></i>';
        icon.replaceWith(c);
      };
    } else {
      icon = document.createElement("div");
      icon.className = "cc";
      icon.innerHTML = '<i class="ti ti-server-2"></i>';
    }
    d.insertBefore(icon, d.firstChild);
    cardByName[p.name] = d;
    d.querySelector(".favstar").onclick = async function (e) {
      e.stopPropagation();
      if (api.favToggle) {
        favorites = await api.favToggle(p.name);
        renderServers();
        toast(favorites.indexOf(p.name) >= 0 ? "В избранном ★" : "Убрано из избранного");
      }
    };
    var pc = d.querySelector(".ping");
    pc.style.cursor = "pointer";
    pc.title = "Пинговать этот сервер";
    pc.onclick = async function (e) {
      e.stopPropagation();
      if (!api.testDelay) return;
      var method = ($("pingMethod") || {}).value || "tcp";
      p._pinging = true;
      patchPing(p);
      try {
        var r = await api.testDelay(p.name, { method: method });
        p.delay = r && r.ok ? r.delay : -1;
      } catch (_) {
        p.delay = -1;
      }
      p._pinging = false;
      patchPing(p);
    };
    d.onclick = async function () {
      sg.querySelectorAll(".scard").forEach(function (x) {
        x.classList.remove("sel");
      });
      d.classList.add("sel");
      $("hsrv").textContent = cleanName(p.name);
      setSrvFlag(p.name);
      if (api.selectProxy) {
        var rr = await api.selectProxy(curGroup, p.name);
        if (!rr.ok) toast("Не удалось выбрать узел");
        else toast("Сервер: " + cleanName(p.name));
      }
    };
    sg.appendChild(d);
  }
  function renderServers() {
    var sg = $("sgrid");
    sg.innerHTML = "";
    cardByName = {};
    var cur = $("hsrv").textContent;
    var arr = sortedProxies();
    var q = ($("ssearch").value || "").trim();
    var groups = [],
      byKey = {};
    arr.forEach(function (p) {
      var key = favorites.indexOf(p.name) >= 0 ? "__fav" : flagAny(p.name) || "__other";
      if (!byKey[key]) {
        byKey[key] = { key: key, items: [] };
        groups.push(byKey[key]);
      }
      byKey[key].items.push(p);
    });
    var countryCnt = groups.filter(function (g) {
      return g.key !== "__fav";
    }).length;
    var useGroups = S.srvGroup !== false && !q && arr.length >= 8 && countryCnt > 1;
    if (!useGroups) {
      arr.forEach(function (p) {
        makeServerCard(p, sg, cur);
      });
      return;
    }
    S.srvCollapsed = S.srvCollapsed || {};
    groups.forEach(function (g) {
      var collapsed = !!S.srvCollapsed[g.key];
      var h = document.createElement("div");
      h.className = "sghead" + (collapsed ? " closed" : "");
      var title =
        g.key === "__fav"
          ? "Избранные"
          : g.key === "__other"
            ? "Другие"
            : CODE_RU[g.key] || g.key.toUpperCase();
      var ic =
        g.key === "__fav"
          ? '<i class="ti ti-star-filled" style="color:var(--cy);font-size:15px"></i>'
          : g.key === "__other"
            ? '<i class="ti ti-world" style="color:var(--dim);font-size:15px"></i>'
            : '<img class="flag" src="https://flagcdn.com/w40/' + g.key + '.png">';
      var best = 1e9;
      g.items.forEach(function (p) {
        if (p.delay > 0 && p.delay < best) best = p.delay;
      });
      h.innerHTML =
        ic +
        '<span class="t">' +
        esc(title) +
        '</span><span class="n">' +
        g.items.length +
        '</span><div class="line"></div>' +
        (best < 1e9
          ? '<span class="best" style="color:' + delayColor(best) + '">от ' + best + " ms</span>"
          : "") +
        '<i class="ti ti-chevron-down ch"></i>';
      var fimg = h.querySelector("img.flag");
      if (fimg)
        fimg.onerror = function () {
          fimg.remove();
        };
      h.onclick = function () {
        S.srvCollapsed[g.key] = !S.srvCollapsed[g.key];
        persist({ srvCollapsed: S.srvCollapsed });
        renderServers();
      };
      sg.appendChild(h);
      if (!collapsed)
        g.items.forEach(function (p) {
          makeServerCard(p, sg, cur);
        });
    });
  }
  $("ssearch").oninput = function () {
    renderServers();
  };
  function syncGroupBtn() {
    var b = $("srvGroupBtn");
    if (b) b.classList.toggle("pri", S.srvGroup !== false);
  }
  if ($("srvGroupBtn"))
    $("srvGroupBtn").onclick = function () {
      persist({ srvGroup: S.srvGroup === false });
      syncGroupBtn();
      renderServers();
      toast(S.srvGroup !== false ? "Группировка по странам включена" : "Плоский список");
    };
  setTimeout(syncGroupBtn, 1200);
  $("srvSort").onchange = function () {
    renderServers();
    persist({ srvSort: this.value });
  };
  $("pingMethod").onchange = function () {
    persist({ pingMethod: this.value });
  };
  $("srvReload").onclick = function () {
    toast("Обновляю…");
    loadServers();
  };
  var pingAllBusy = false;
  $("pingAll").onclick = async function () {
    if (!api.testDelay || !allProxies.length) {
      toast("Сначала добавьте подписку");
      return;
    }
    if (pingAllBusy) return;
    pingAllBusy = true;
    this.disabled = true;
    var method = $("pingMethod").value;
    toast("Проверяю задержку (" + method.toUpperCase() + ")…");
    allProxies.forEach(function (p) {
      p._pinging = true;
    });
    renderServers();
    var queue = allProxies.slice(),
      CONC = method === "http" ? 6 : 40;
    async function worker() {
      while (queue.length) {
        var p = queue.shift();
        try {
          var r = await api.testDelay(p.name, { method: method });
          p.delay = r && r.ok ? r.delay : -1;
        } catch (e) {
          p.delay = -1;
        }
        p._pinging = false;
        patchPing(p);
      }
    }
    var workers = [];
    for (var i = 0; i < CONC; i++) workers.push(worker());
    await Promise.all(workers);
    if ($("srvSort").value === "ping") renderServers();
    toast("Готово ✓");
    pingAllBusy = false;
    this.disabled = false;
  };
  function fmtDays(exp) {
    if (!exp) return "";
    var d = Math.ceil((exp * 1e3 - Date.now()) / 864e5);
    return d > 0 ? "осталось " + d + " дн." : "истекла";
  }
  function fmtGB(b) {
    return (b / 1e9).toFixed(1) + " ГБ";
  }
  async function loadSub() {
    if (!api.subList) return;
    var r = await api.subList();
    var box = $("subList");
    box.innerHTML = "";
    try {
      fillSubWidgets(r.subs, r.active);
    } catch (e) {}
    if (!r.subs || !r.subs.length) {
      box.innerHTML =
        '<div class="empty" style="padding:18px"><i class="ti ti-ticket-off"></i><div class="et">Нет подписок</div><div class="es">Вставьте ссылку ниже и нажмите «Добавить»</div></div>';
      return;
    }
    r.subs.forEach(function (s) {
      var active = s.id === r.active;
      var esc = function (t) {
        var e = document.createElement("span");
        e.textContent = t == null ? "" : t;
        return e.innerHTML;
      };
      var info = "";
      var icon = "ti-ticket",
        iconCss = "background:rgba(82,240,228,.14);color:var(--cy)";
      if (s.local) {
        icon = "ti-shield-bolt";
        iconCss = "background:rgba(255,178,77,.14);color:#ffb24d";
        info = "Свой файл · " + (s.endpoint || "—");
      } else if (s.userinfo) {
        info = fmtDays(s.userinfo.expire);
        if (s.userinfo.total)
          info += (info ? " · " : "") + fmtGB(s.userinfo.used) + " / " + fmtGB(s.userinfo.total);
      }
      var d = document.createElement("div");
      d.className = "rule";
      if (active) {
        d.style.borderColor = "var(--cy)";
        d.style.boxShadow = "0 0 0 1px var(--cy)";
      }
      d.innerHTML =
        '<div class="tic" style="' +
        iconCss +
        '"><i class="ti ' +
        icon +
        '"></i></div>' +
        '<div class="rt"><div class="a">' +
        esc(s.name) +
        (active ? " · активна" : "") +
        '</div><div class="b" style="font-family:inherit">' +
        esc(info || s.url) +
        "</div></div>" +
        '<div class="ra" style="opacity:1;gap:12px">' +
        (active ? "" : '<i class="ti ti-circle-check" title="Сделать активной"></i>') +
        '<i class="ti ti-pencil" title="' +
        (s.local ? "Изменить имя / точку входа" : "Изменить имя/ссылку") +
        '"></i>' +
        (s.local ? "" : '<i class="ti ti-refresh" title="Обновить"></i>') +
        '<i class="ti ti-trash" title="Удалить"></i></div>';
      var chk = d.querySelector(".ti-circle-check");
      if (chk)
        chk.onclick = async function () {
          toast("Переключаю…");
          var x = await api.setActiveSub(s.id);
          if (x.ok) {
            toast("Активна: " + s.name);
            loadSub();
            loadServers();
          } else toast("Ошибка: " + x.error);
        };
      d.querySelector(".ti-pencil").onclick = function () {
        openSubEdit(d, s);
      };
      var rf = d.querySelector(".ti-refresh");
      if (rf)
        rf.onclick = async function () {
          toast("Обновляю подписку…");
          var x = await api.updateSub(s.id);
          if (x.ok) {
            toast("Обновлено ✓");
            loadSub();
            loadServers();
          } else toast("Ошибка: " + x.error);
        };
      d.querySelector(".ti-trash").onclick = async function () {
        var x = await api.removeSub(s.id);
        if (x.ok) {
          toast(s.local ? "Конфиг удалён" : "Подписка удалена");
          loadSub();
          loadServers();
        } else toast("Ошибка");
      };
      box.appendChild(d);
    });
  }
  function openSubEdit(card, s) {
    if (card.querySelector(".subedit")) return;
    var box = document.createElement("div");
    box.className = "subedit";
    box.style.cssText =
      "flex-basis:100%;margin-top:10px;display:flex;flex-direction:column;gap:8px";
    box.innerHTML =
      '<input class="inp se-name" placeholder="Имя" style="width:100%">' +
      (s.local
        ? '<input class="inp se-endpoint" placeholder="Точка входа: хост:порт" style="width:100%">'
        : '<input class="inp se-url" placeholder="Ссылка на подписку" style="width:100%">') +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="tbtn se-cancel" style="width:auto;padding:8px 16px">Отмена</button>' +
      '<button class="tbtn pri se-save" style="width:auto;padding:8px 16px"><i class="ti ti-check"></i>Сохранить</button>' +
      "</div>";
    card.appendChild(box);
    box.querySelector(".se-name").value = s.name || "";
    if (s.local) box.querySelector(".se-endpoint").value = s.endpoint || "";
    else box.querySelector(".se-url").value = s.url || "";
    box.querySelector(".se-cancel").onclick = function () {
      box.remove();
    };
    box.querySelector(".se-save").onclick = async function () {
      var name = box.querySelector(".se-name").value.trim();
      var btn = this;
      btn.style.opacity = 0.6;
      btn.innerHTML = '<i class="ti ti-loader"></i>';
      var x = s.local
        ? await api.editSub(s.id, name, undefined, box.querySelector(".se-endpoint").value.trim())
        : await api.editSub(s.id, name, box.querySelector(".se-url").value.trim());
      if (x && x.ok) {
        toast("Сохранено ✓");
        loadSub();
        loadServers();
      } else {
        toast("Ошибка: " + ((x && x.error) || "—"));
        btn.style.opacity = 1;
        btn.innerHTML = '<i class="ti ti-check"></i>Сохранить';
      }
    };
  }
  $("subAdd").onclick = async function () {
    var url = $("subUrl").value.trim();
    if (!url) {
      toast("Вставьте ссылку на подписку");
      return;
    }
    try {
      if (btoa(url.toLowerCase()) === "c25vdy1kZXY=") {
        $("subUrl").value = "";
        await devUnlock(true);
        return;
      }
    } catch (_) {}
    var btn = this;
    btn.disabled = true;
    btn.style.opacity = 0.6;
    btn.innerHTML = '<i class="ti ti-loader"></i>Загрузка…';
    try {
      var r = await api.importSub(url);
      if (r && r.ok) {
        toast("Подписка добавлена ✓");
        $("subUrl").value = "";
        loadSub();
        loadServers();
      } else if (r && r.needSub) {
        $("buySubModal").style.display = "flex";
      } else toast("Ошибка: " + ((r && r.error) || "—"));
    } catch (e) {
      toast("Ошибка: " + e.message);
    }
    btn.disabled = false;
    btn.style.opacity = 1;
    btn.innerHTML = '<i class="ti ti-plus"></i>Добавить и применить';
  };
  $("buyBtn").onclick = function () {
    if (api.openExternal) api.openExternal("https://snowservice.github.io/snowvpn/");
  };
  var BOT_SUB_URL = "https://t.me/SnowfallVPN_bot?start=partner_p1_6b5c2Nm_nEU9Sm3-Bj0";
  if ($("bsClose"))
    $("bsClose").onclick = function () {
      $("buySubModal").style.display = "none";
    };
  if ($("buySubModal"))
    $("buySubModal").onclick = function (e) {
      if (e.target === this) this.style.display = "none";
    };
  if ($("bsBuy"))
    $("bsBuy").onclick = function () {
      if (api.openExternal) api.openExternal(BOT_SUB_URL);
      $("buySubModal").style.display = "none";
    };
  if ($("mpAdd"))
    $("mpAdd").onclick = async function () {
      if (!api.manualAdd) return;
      var btn = this;
      btn.disabled = true;
      var was = btn.innerHTML;
      btn.innerHTML = '<i class="ti ti-loader"></i>Выберите файл…';
      var r = await api.manualAdd();
      btn.disabled = false;
      btn.innerHTML = was;
      if (r && r.ok) {
        toast("Добавлено: " + r.name + " — нажмите ✓ рядом с ним, чтобы переключиться");
        loadSub();
        loadServers();
      } else if (r && r.error) toast(r.error);
    };
  var devOn = false;
  function devApplyUi() {
    var box = $("devBox");
    if (box) box.style.display = devOn ? "" : "none";
    if ($("mpAdd")) $("mpAdd").style.display = devOn ? "" : "none";
  }
  async function devUnlock(fresh) {
    devOn = true;
    if (fresh && api.manualUnlock) await api.manualUnlock();
    devApplyUi();
    if (fresh) {
      toast("Режим разработчика включён ❄");
      go("subs");
    }
  }
  if (api.manualState) {
    api
      .manualState()
      .then(function (st) {
        devOn = !!(st && st.unlocked);
        if (st && st.userAgent && $("devUa")) $("devUa").value = st.userAgent;
        if ($("devForce")) $("devForce").classList.toggle("on", !!(st && st.force));
        devApplyUi();
      })
      .catch(function () {});
  }
  if ($("devOff"))
    $("devOff").onclick = async function () {
      if (api.manualLock) await api.manualLock();
      devOn = false;
      devApplyUi();
      toast("Режим разработчика выключен");
    };
  if ($("devUa"))
    $("devUa").onchange = function () {
      if (api.manualSetUa) api.manualSetUa(this.value.trim());
      toast(this.value.trim() ? "User-Agent изменён" : "User-Agent — как обычно");
    };
  document.querySelectorAll("#devUaPresets .chip3").forEach(function (c) {
    c.onclick = function () {
      var v = c.getAttribute("data-ua") || "";
      if ($("devUa")) {
        $("devUa").value = v;
      }
      if (api.manualSetUa) api.manualSetUa(v);
      document.querySelectorAll("#devUaPresets .chip3").forEach(function (x) {
        x.classList.toggle("on", x === c);
      });
      toast(v ? "User-Agent: " + (c.textContent || "").trim() : "User-Agent — как обычно");
    };
  });
  if ($("devForce"))
    $("devForce").onclick = function () {
      var on = !this.classList.contains("on");
      this.classList.toggle("on", on);
      if (api.manualSetForce) api.manualSetForce(on);
    };
  var TYPE_LABEL = {
    process: "Программа",
    domainSuffix: "По суффиксу",
    domainKeyword: "Слово в домене",
    geoSite: "GeoSite",
    geoIp: "GeoIP · страна",
    ipCidr: "IP-диапазон",
  };
  var TYPE_META = {
    process: ["ti-app-window", "#5b9eff"],
    domainSuffix: ["ti-world-www", "#5dcaa5"],
    domainKeyword: ["ti-search", "#9b8cff"],
    geoSite: ["ti-world-search", "#43e08a"],
    geoIp: ["ti-map-pin", "#ff9e64"],
    ipCidr: ["ti-affiliate", "#3db9f0"],
  };
  var BRAND = {
    telegram: ["ti-brand-telegram", "#2aabee"],
    netflix: ["ti-brand-netflix", "#e50914"],
    twitch: ["ti-brand-twitch", "#9146ff"],
    tiktok: ["ti-brand-tiktok", "#ff2d55"],
    google: ["ti-brand-google", "#4285f4"],
    openai: ["ti-brand-openai", "#10a37f"],
    discord: ["ti-brand-discord", "#5865f2"],
    instagram: ["ti-brand-instagram", "#e1306c"],
    youtube: ["ti-brand-youtube", "#ff3030"],
    twitter: ["ti-brand-x", "#1d9bf0"],
    x: ["ti-brand-x", "#1d9bf0"],
    anthropic: ["ti-sparkles", "#d4915d"],
    xai: ["ti-sparkles", "#888"],
    github: ["ti-brand-github", "#c9d1d9"],
    facebook: ["ti-brand-facebook", "#1877f2"],
    spotify: ["ti-brand-spotify", "#1db954"],
    whatsapp: ["ti-brand-whatsapp", "#25d366"],
    steam: ["ti-brand-steam", "#66c0f4"],
  };
  function ruleIcon(r) {
    var key = (r.value || "")
      .toLowerCase()
      .replace(".exe", "")
      .replace(/^category-/, "");
    if (BRAND[key]) return BRAND[key];
    return TYPE_META[r.type] || ["ti-circle", "#9fc4cf"];
  }
  var ACT = { vpn: ["Через VPN", "no"], no: ["Без VPN", "vpn"], block: ["Без VPN", "vpn"] };
  function ruleHuman(r) {
    var v = String(r.value || "");
    switch (r.type) {
      case "process":
        return "Программа " + v;
      case "geoSite":
        return "Сайты и сервисы " + v;
      case "domainSuffix":
        return v.charAt(0) === "." ? "Все сайты в зоне " + v : "Сайт " + v + " и его поддомены";
      case "domainKeyword":
        return "Адреса, где встречается «" + v + "»";
      case "ipCidr":
        return v === "0.0.0.0/0" ? "Весь трафик целиком" : "IP-адреса " + v;
      case "geoIp":
        return "IP-адреса страны " + v.toUpperCase();
    }
    return TYPE_LABEL[r.type] || String(r.type || "");
  }
  var MIHOMO_TYPE = {
    "PROCESS-NAME": "process",
    "DOMAIN-SUFFIX": "domainSuffix",
    "DOMAIN-KEYWORD": "domainKeyword",
    DOMAIN: "domainSuffix",
    GEOSITE: "geoSite",
    GEOIP: "geoIp",
    "IP-CIDR": "ipCidr",
    "IP-CIDR6": "ipCidr",
  };
  var TYPE_MIHOMO = {
    process: "PROCESS-NAME",
    domainSuffix: "DOMAIN-SUFFIX",
    domainKeyword: "DOMAIN-KEYWORD",
    geoSite: "GEOSITE",
    geoIp: "GEOIP",
    ipCidr: "IP-CIDR",
  };
  function ruleStrToObj(s) {
    var parts = String(s)
      .split(",")
      .map(function (x) {
        return x.trim();
      });
    if (parts.length < 3) return null;
    var type = MIHOMO_TYPE[parts[0].toUpperCase()];
    if (!type) return null;
    var value = parts[1];
    var tU = parts[2].toUpperCase();
    var action = "vpn",
      proxy = "";
    if (tU === "DIRECT") action = "no";
    else if (tU === "REJECT") action = "block";
    else if (tU !== "PROXY" && tU !== "GLOBAL") proxy = parts[2];
    var name = type === "process" ? value.replace(/\.exe$/i, "") : value;
    var o = { type: type, name: name, value: value, action: action, enabled: true };
    if (proxy) o.proxy = proxy;
    return o;
  }
  function ruleObjToStr(r) {
    var t = TYPE_MIHOMO[r.type];
    if (!t) return null;
    var v = (r.value || "").trim();
    if (!v) return null;
    if (r.type === "domainSuffix") v = v.replace(/^[*+]?\./, "");
    var target =
      r.action === "no" ? "DIRECT" : r.action === "block" ? "REJECT" : r.proxy || "Proxy";
    var line = t + "," + v + "," + target;
    if (r.type === "ipCidr") line += ",no-resolve";
    return line;
  }
  var TYPE_HINT = {
    process: "Трафик конкретной программы. Введите имя .exe или выберите из запущенных.",
    geoSite: "Готовая категория сайтов сервиса (YouTube, Netflix, Telegram и т.д.).",
    domainSuffix: "Адрес и все его поддомены: avito.ru → m.avito.ru. Или целая зона: .ru, .su, .рф",
    domainKeyword:
      "Любой адрес, где встречается слово: avito → avito.ru, avito.st, static-avito.com",
    geoIp: "IP-адреса страны или сервиса. Напр.: telegram, ru",
    ipCidr:
      "0.0.0.0/0 — весь трафик (Через ВПН / Без ВПН выбирается в «Действие»). Или диапазон, напр.: 104.16.0.0/12",
  };
  var rulesData = [];
  var dragSrc = null;
  function renderRules() {
    var rl = $("rlist");
    rl.innerHTML = "";
    var cnt = $("ruleCount");
    if (cnt) cnt.textContent = rulesData.length;
    var q = (($("ruleSearch") || {}).value || "").toLowerCase();
    var emp = $("rulesEmpty");
    var shown = rulesData
      .map(function (r, i) {
        return { r: r, i: i };
      })
      .filter(function (o) {
        return (
          !q ||
          String(o.r.name || "")
            .toLowerCase()
            .indexOf(q) >= 0 ||
          String(o.r.value || "")
            .toLowerCase()
            .indexOf(q) >= 0
        );
      });
    if (emp)
      emp.innerHTML = !rulesData.length
        ? '<div class="empty" style="padding:30px"><i class="ti ti-filter-off"></i><div class="et">Правил пока нет</div><div class="es">Добавьте правило или нажмите «Готовые правила»</div></div>'
        : "";
    shown.forEach(function (o) {
      var r = o.r,
        idx = o.i;
      var ic = ruleIcon(r);
      var vpnOn = r.action === "vpn";
      var sub = esc(ruleHuman(r));
      if (r.proxy) {
        var fc = flagAny(r.proxy);
        sub +=
          " · " +
          (fc
            ? '<img class="flag" src="https://flagcdn.com/w40/' +
              fc +
              '.png" style="width:16px;height:12px;border-radius:2px;object-fit:cover;vertical-align:-1px;margin-right:3px">'
            : "") +
          esc(cleanName(r.proxy));
      }
      var d = document.createElement("div");
      d.className = "rrow" + (r.invalid ? " rrow-invalid" : "");
      d.setAttribute("data-n", idx + 1);
      if (!q) {
        d.draggable = true;
        d.style.cursor = "grab";
      }
      var act = ACT[r.action] ? r.action : "no";
      d.innerHTML =
        '<div class="rav" style="background:' +
        ic[1] +
        "22;color:" +
        ic[1] +
        '"><i class="ti ' +
        ic[0] +
        '"></i></div>' +
        '<div class="rt"><div class="a">' +
        esc(r.name) +
        (r.invalid
          ? ' <span class="rinvalid" title="' +
            esc(r.invalidReason || "Автоматически отключено — некорректное значение") +
            '">Невалидно</span>'
          : "") +
        '</div><div class="b">' +
        sub +
        "</div></div>" +
        '<span class="rbadge ' +
        act +
        '" title="Изменить">' +
        ACT[act][0] +
        "</span>" +
        '<div class="rsw' +
        (vpnOn ? " on" : "") +
        '" title="Через VPN: вкл/выкл"></div>' +
        '<i class="ti ti-pencil redit" title="Изменить"></i>' +
        '<i class="ti ti-trash rdel" title="Удалить"></i>';
      var flg = d.querySelector("img.flag");
      if (flg)
        flg.onerror = function () {
          flg.remove();
        };
      d.querySelector(".rbadge").onclick = function () {
        openRuleModal(idx);
      };
      d.querySelector(".rsw").onclick = function () {
        r.action = r.action === "vpn" ? "no" : "vpn";
        renderRules();
        persistRules();
      };
      d.querySelector(".redit").onclick = function () {
        openRuleModal(idx);
      };
      d.querySelector(".rdel").onclick = function () {
        rulesData.splice(idx, 1);
        renderRules();
        persistRules();
        toast("Правило удалено");
      };
      if (!q) {
        d.addEventListener("dragstart", function (e) {
          dragSrc = idx;
          d.style.opacity = "0.4";
          e.dataTransfer.effectAllowed = "move";
          try {
            e.dataTransfer.setData("text/plain", String(idx));
          } catch (_) {}
        });
        d.addEventListener("dragend", function () {
          d.style.opacity = "";
          d.style.outline = "";
        });
        d.addEventListener("dragover", function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          d.style.outline = "2px dashed var(--cy)";
          d.style.outlineOffset = "-2px";
        });
        d.addEventListener("dragleave", function () {
          d.style.outline = "";
        });
        d.addEventListener("drop", function (e) {
          e.preventDefault();
          d.style.outline = "";
          if (dragSrc === null || dragSrc === idx) return;
          var moved = rulesData.splice(dragSrc, 1)[0];
          rulesData.splice(idx, 0, moved);
          dragSrc = null;
          renderRules();
          persistRules();
          toast("Порядок обновлён ✓");
        });
      }
      rl.appendChild(d);
    });
    renderProfiles();
  }
  function persistRules() {
    if (api.saveRules) {
      Promise.resolve(api.saveRules(rulesData))
        .then(function (res) {
          if (!res || !Array.isArray(res.rules)) return;
          if (res.invalid && res.invalid.length) {
            rulesData = res.rules;
            renderRules();
            toast(
              "Отключено некорректных правил: " + res.invalid.length + " — они помечены в списке",
            );
          }
        })
        .catch(function () {});
    }
    if (!S.rulesSeeded) {
      S.rulesSeeded = true;
      if (api.saveSettings) api.saveSettings({ rulesSeeded: true });
    }
    profPersist();
  }
  var ruleProfiles = [];
  var activeProfId = null;
  function profNewId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function profById(id) {
    for (var i = 0; i < ruleProfiles.length; i++)
      if (ruleProfiles[i].id === id) return ruleProfiles[i];
    return null;
  }
  function profSyncActive() {
    var p = profById(activeProfId);
    if (p) p.rules = rulesData.slice();
  }
  function profPersist() {
    if (!ruleProfiles.length) return;
    profSyncActive();
    if (api.saveSettings)
      api.saveSettings({ ruleProfiles: ruleProfiles, activeRuleProfile: activeProfId });
  }
  function profInit() {
    ruleProfiles = Array.isArray(S.ruleProfiles)
      ? S.ruleProfiles.filter(function (p) {
          return p && p.id && p.name;
        })
      : [];
    if (!ruleProfiles.length) {
      ruleProfiles = [{ id: profNewId(), name: "Основной", rules: rulesData.slice() }];
      activeProfId = ruleProfiles[0].id;
      profPersist();
    } else {
      activeProfId = S.activeRuleProfile;
      if (!profById(activeProfId)) activeProfId = ruleProfiles[0].id;
    }
    renderProfiles();
  }
  function renderProfiles() {
    var box = $("rProfChips");
    if (!box) return;
    box.innerHTML = "";
    ruleProfiles.forEach(function (p) {
      var on = p.id === activeProfId;
      var el = document.createElement("div");
      el.className = "rpchipx" + (on ? " on" : "");
      el.innerHTML =
        '<span class="n">' +
        esc(p.name) +
        "</span>" +
        '<span class="cnt">' +
        (on ? rulesData.length : (p.rules || []).length) +
        "</span>" +
        '<i class="ti ti-dots pedit" title="Переименовать или удалить"></i>';
      el.onclick = function () {
        profSwitch(p.id);
      };
      el.querySelector(".pedit").onclick = function (e) {
        e.stopPropagation();
        openProfModal(p);
      };
      box.appendChild(el);
    });
  }
  function profSwitch(id) {
    if (id === activeProfId) return;
    var t = profById(id);
    if (!t) return;
    profSyncActive();
    activeProfId = id;
    rulesData = (t.rules || []).slice();
    renderRules();
    persistRules();
    toast("Профиль: " + t.name);
  }
  var profEditRef = null,
    pmCopy = "empty";
  function openProfModal(p) {
    profEditRef = p || null;
    var m = $("profModal");
    if (!m) return;
    $("pmTitle").textContent = p ? "Профиль" : "Новый профиль";
    $("pmName").value = p ? p.name : "";
    $("pmSave").textContent = p ? "Сохранить" : "Создать";
    $("pmCopyField").style.display = p ? "none" : "";
    $("pmDelete").style.display = p && ruleProfiles.length > 1 ? "" : "none";
    $("pmErr").style.display = "none";
    pmCopy = "empty";
    Array.prototype.forEach.call($("pmCopyChips").children, function (c) {
      c.classList.toggle("on", c.getAttribute("data-v") === "empty");
    });
    m.style.display = "flex";
    setTimeout(function () {
      try {
        $("pmName").focus();
      } catch (_) {}
    }, 40);
  }
  function closeProfModal() {
    var m = $("profModal");
    if (m) m.style.display = "none";
    profEditRef = null;
  }
  if ($("pmCopyChips"))
    Array.prototype.forEach.call($("pmCopyChips").children, function (c) {
      c.onclick = function () {
        pmCopy = c.getAttribute("data-v");
        Array.prototype.forEach.call($("pmCopyChips").children, function (x) {
          x.classList.toggle("on", x === c);
        });
      };
    });
  if ($("pmCancel")) $("pmCancel").onclick = closeProfModal;
  if ($("profModal"))
    $("profModal").onclick = function (e) {
      if (e.target === $("profModal")) closeProfModal();
    };
  if ($("pmName"))
    $("pmName").onkeydown = function (e) {
      if (e.key === "Enter") $("pmSave").click();
    };
  if ($("pmSave"))
    $("pmSave").onclick = function () {
      var name = ($("pmName").value || "").trim();
      if (!name) {
        $("pmErr").textContent = "Введите название";
        $("pmErr").style.display = "";
        return;
      }
      var dup = ruleProfiles.some(function (p) {
        return p !== profEditRef && p.name.toLowerCase() === name.toLowerCase();
      });
      if (dup) {
        $("pmErr").textContent = "Профиль с таким именем уже есть";
        $("pmErr").style.display = "";
        return;
      }
      if (profEditRef) {
        profEditRef.name = name;
        renderProfiles();
        profPersist();
        closeProfModal();
        toast("Переименовано ✓");
        return;
      }
      var np = { id: profNewId(), name: name, rules: pmCopy === "copy" ? rulesData.slice() : [] };
      profSyncActive();
      ruleProfiles.push(np);
      activeProfId = np.id;
      rulesData = np.rules.slice();
      renderRules();
      persistRules();
      closeProfModal();
      toast("Профиль «" + name + "» создан ✓");
    };
  if ($("pmDelete"))
    $("pmDelete").onclick = function () {
      var p = profEditRef;
      if (!p || ruleProfiles.length < 2) return;
      var wasActive = p.id === activeProfId;
      ruleProfiles = ruleProfiles.filter(function (x) {
        return x !== p;
      });
      if (wasActive) {
        activeProfId = ruleProfiles[0].id;
        rulesData = (ruleProfiles[0].rules || []).slice();
        renderRules();
        persistRules();
      } else {
        renderProfiles();
        profPersist();
      }
      closeProfModal();
      toast("Профиль «" + p.name + "» удалён");
    };
  if ($("rProfAdd"))
    $("rProfAdd").onclick = function () {
      openProfModal(null);
    };
  renderRules();
  var editIdx = -1,
    editRef = null;
  var rmProxyValue = "";
  function setProxyDisplay(val) {
    rmProxyValue = val || "";
    $("rmProxyText").textContent = rmProxyValue
      ? cleanName(rmProxyValue)
      : "Авто — выбранный сервер";
    $("rmProxySelect").classList.toggle("empty", !rmProxyValue);
  }
  async function ensureServerNames() {
    if (!serverNames.length && api.proxyGroups) {
      try {
        var rr = await api.proxyGroups();
        var g =
          (rr.groups || []).find(function (x) {
            return x.name !== "GLOBAL";
          }) || (rr.groups || [])[0];
        if (g)
          serverNames = (g.all || []).map(function (p) {
            return p.name;
          });
      } catch (e) {}
    }
  }
  function getChip(id) {
    var on = $(id).querySelector(".chip3.on");
    return on ? on.dataset.v : null;
  }
  function setChip(id, val) {
    $(id)
      .querySelectorAll(".chip3")
      .forEach(function (c) {
        c.classList.toggle("on", c.dataset.v === val);
      });
  }
  function toggleProxyField() {
    $("rmProxyField").style.display = getChip("rmActionChips") === "vpn" ? "block" : "none";
  }
  $("rmTypeChips")
    .querySelectorAll(".chip3")
    .forEach(function (c) {
      c.onclick = function () {
        setChip("rmTypeChips", c.dataset.v);
        $("rmValue").value = "";
        updateValueField();
      };
    });
  $("rmActionChips")
    .querySelectorAll(".chip3")
    .forEach(function (c) {
      c.onclick = function () {
        setChip("rmActionChips", c.dataset.v);
        toggleProxyField();
      };
    });
  function updateValueField() {
    var t = getChip("rmTypeChips");
    $("rmHint").textContent = TYPE_HINT[t] || "";
    var ph = {
      process: "Telegram.exe",
      domainSuffix: "youtube.com",
      domainKeyword: "google",
      geoSite: "youtube, category-ads-all, rutracker…",
      geoIp: "telegram",
      ipCidr: "0.0.0.0/0 (весь трафик) или 104.16.0.0/12",
    };
    $("rmValueRow").style.display = "flex";
    $("rmValueSelect").style.display = "none";
    $("rmPick").style.display = t === "process" || t === "geoSite" ? "inline-flex" : "none";
    if ($("rmAllTraffic"))
      $("rmAllTraffic").style.display = t === "ipCidr" ? "inline-flex" : "none";
    $("rmValLabel").textContent = t === "geoSite" ? "Категория (из geosite.dat)" : "Значение";
    $("rmValue").placeholder = ph[t] || "значение";
  }
  $("rmValueSelect").onclick = function () {
    openPicker("geoSite");
  };
  var GEOSITES = [
    "youtube",
    "google",
    "telegram",
    "twitter",
    "facebook",
    "instagram",
    "discord",
    "openai",
    "anthropic",
    "tiktok",
    "twitch",
    "netflix",
    "spotify",
    "reddit",
    "pinterest",
    "linkedin",
    "snapchat",
    "whatsapp",
    "zoom",
    "github",
    "gitlab",
    "microsoft",
    "apple",
    "amazon",
    "steam",
    "epicgames",
    "cloudflare",
    "paypal",
    "onedrive",
    "dropbox",
    "notion",
    "slack",
    "signal",
    "protonmail",
    "tutanota",
    "bitwarden",
    "vimeo",
    "soundcloud",
    "tumblr",
    "flickr",
    "imgur",
    "patreon",
    "medium",
    "wordpress",
    "shopify",
    "stripe",
    "trello",
    "atlassian",
    "jetbrains",
    "docker",
    "kubernetes",
    "digitalocean",
    "vultr",
    "akamai",
    "fastly",
    "netlify",
    "vercel",
    "heroku",
    "oracle",
    "ibm",
    "azure",
    "aws",
    "google-play",
    "icloud",
    "disney",
    "hulu",
    "primevideo",
    "hbo",
    "peacock",
    "paramountplus",
    "dazn",
    "mubi",
    "plex",
    "tubi",
    "roku",
    "sling",
    "blizzard",
    "riot",
    "roblox",
    "rockstar",
    "ubisoft",
    "nintendo",
    "playstation",
    "xbox",
    "gog",
    "origin",
    "baidu",
    "bilibili",
    "weibo",
    "iqiyi",
    "youku",
    "douyin",
    "douban",
    "wechat",
    "qq",
    "tencent",
    "netease",
    "ximalaya",
    "zhihu",
    "taobao",
    "jd",
    "pinduoduo",
    "meituan",
    "didi",
    "alipay",
    "alibaba",
    "alibabacloud",
    "aliyun",
    "huawei",
    "xiaomi",
    "oppo",
    "vivo",
    "bytedance",
    "kuaishou",
    "cctv",
    "sina",
    "sohu",
    "mango",
    "youzan",
    "feishu",
    "dingtalk",
    "xunlei",
    "wps",
    "qihoo360",
    "baidu-ads",
    "tencent-ads",
    "bytedance-ads",
    "kuaishou-ads",
    "netease-ads",
    "bbc",
    "cnn",
    "reuters",
    "nytimes",
    "theguardian",
    "bloomberg",
    "wsj",
    "economist",
    "forbes",
    "techcrunch",
    "vox",
    "huffpost",
    "aljazeera",
    "rferl",
    "voanews",
    "boxun",
    "rthk",
    "scmp",
    "nvidia",
    "amd",
    "intel",
    "qualcomm",
    "broadcom",
    "cisco",
    "dell",
    "hp",
    "lenovo",
    "asus",
    "acer",
    "samsung",
    "sony",
    "lg",
    "android",
    "golang",
    "python",
    "ruby",
    "rust",
    "nodejs",
    "dart",
    "flutter",
    "linux",
    "debian",
    "ubuntu",
    "fedora",
    "archlinux",
    "nixos",
    "homebrew",
    "sourceforge",
    "npm",
    "pypi",
    "rubygems",
    "crates",
    "hackernews",
    "category-ads",
    "category-ads-all",
    "category-porn",
    "category-scholar",
    "category-games",
    "category-games-cn",
    "category-social-media-cn",
    "category-social-media-ir",
    "category-media",
    "category-media-cn",
    "category-media-ru",
    "category-news-ir",
    "category-gov-ru",
    "category-gov-ir",
    "category-bank-cn",
    "category-bank-ir",
    "category-bank-jp",
    "category-cryptocurrency",
    "category-vpnservices",
    "category-anticensorship",
    "category-dev",
    "category-dev-cn",
    "category-entertainment",
    "category-entertainment-cn",
    "category-education-cn",
    "category-education-ir",
    "category-finance",
    "category-ecommerce",
    "category-speedtest",
    "category-remote-control",
    "category-container",
    "category-acg",
    "category-ddns",
    "category-ipfs",
    "category-ir",
    "category-ru",
    "category-scholar-cn",
    "category-communication",
    "category-ntp",
    "category-ntp-cn",
    "category-tech-media",
    "category-pt",
    "category-public-tracker",
    "gfw",
    "geolocation-cn",
    "cn",
    "tld-cn",
    "binance",
    "coinbase",
    "kraken",
    "okx",
    "huobi",
    "bybit",
    "ethereum",
    "bitcoin",
    "trustwallet",
    "metamask",
    "adblock",
    "adblockplus",
    "adguard",
    "easylist",
    "drweb",
    "kaspersky",
    "eset",
    "symantec",
    "fortinet",
    "cloudflare-ipfs",
    "jsdelivr",
    "bootcdn",
    "staticfile",
    "unpkg",
    "fontawesome",
    "fonts",
    "google-fonts",
    "gravatar",
    "deepseek",
    "perplexity",
    "groq",
    "xai",
    "mistral",
    "figma",
    "canva",
    "adobe",
    "autodesk",
    "sketch",
    "webex",
    "teams",
    "meet",
    "duckduckgo",
    "startpage",
    "qwant",
    "brave",
    "wikipedia",
    "wikimedia",
    "quora",
    "stackexchange",
    "duolingo",
    "coursera",
    "udemy",
    "edx",
    "khanacademy",
    "libgen",
    "sci-hub",
    "z-library",
    "annas-archive",
    "pixiv",
    "deviantart",
    "artstation",
    "behance",
    "ebay",
    "aliexpress",
    "walmart",
    "target",
    "etsy",
    "booking",
    "airbnb",
    "uber",
    "lyft",
    "line",
    "viber",
    "kakao",
    "naver",
    "apple-cn",
    "apple-dev",
    "apple-tvplus",
    "apple-intelligence",
    "google-scholar",
    "google-deepmind",
    "google-gemini",
    "microsoft-dev",
    "github1s",
    "steamunlocked",
    "itch",
    "archive",
    "archiveofourown",
    "gutenberg",
    "tracker",
    "nyaa",
    "rutracker",
    "rarbg",
    "piratebay",
    "tailscale",
    "wireguard",
    "openvpn",
    "nordvpn",
    "expressvpn",
    "hoyoverse",
    "mihoyo",
    "genshin",
    "kurogames",
    "bluearchive",
  ];
  var _geoCache = null;
  async function realGeoSites() {
    if (_geoCache) return _geoCache;
    if (api.geoSites) {
      try {
        var l = await api.geoSites();
        if (Array.isArray(l) && l.length) {
          _geoCache = l;
          return l;
        }
      } catch (e) {}
    }
    _geoCache = GEOSITES;
    return _geoCache;
  }
  var pickData = [],
    pickType = "geoSite";
  function prettyName(v) {
    v = v
      .replace(/\.exe$/i, "")
      .replace(/^category-/, "")
      .replace(/-/g, " ");
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
  function renderPick() {
    var q = ($("pickSearch").value || "").toLowerCase();
    var box = $("pickList");
    box.innerHTML = "";
    var shown = pickData
      .filter(function (it) {
        return !q || it.label.toLowerCase().indexOf(q) >= 0;
      })
      .slice(0, 400);
    shown.forEach(function (it) {
      var d = document.createElement("div");
      d.className = "pickitem";
      var ic = it.flag
        ? '<img class="flag" src="https://flagcdn.com/w40/' +
          it.flag +
          '.png" style="width:30px;height:22px;border-radius:4px;object-fit:cover">'
        : '<div class="pi-ic"' +
          (it.color ? ' style="color:' + it.color + '"' : "") +
          '><i class="ti ' +
          it.icon +
          '"></i></div>';
      d.innerHTML = ic + '<div class="pi-t"><div class="pi-a">' + esc(it.label) + "</div></div>";
      d.onclick = function () {
        if (pickType === "server") {
          setProxyDisplay(it.v);
        } else {
          $("rmValue").value = it.v;
          if (!$("rmName").value.trim()) $("rmName").value = prettyName(it.v);
          updateValueField();
        }
        $("pickModal").classList.remove("show");
      };
      box.appendChild(d);
    });
    if (!box.children.length)
      box.innerHTML =
        '<div class="empty" style="padding:20px"><div class="es">Ничего не найдено</div></div>';
  }
  async function openPicker(type) {
    pickType = type;
    $("pickTitle").textContent =
      type === "process"
        ? "Запущенные процессы"
        : type === "server"
          ? "Выбор сервера"
          : "Категории GeoSite";
    $("pickSearch").value = "";
    $("pickModal").classList.add("show");
    if (type === "process") {
      $("pickList").innerHTML =
        '<div class="empty" style="padding:20px"><div class="es">Загрузка процессов…</div></div>';
      var list = api.listProcesses ? await api.listProcesses() : [];
      pickData = list.map(function (n) {
        var k = n.toLowerCase().replace(".exe", "");
        var b = BRAND[k];
        return { v: n, label: n, icon: b ? b[0] : "ti-app-window", color: b ? b[1] : null };
      });
    } else if (type === "server") {
      await ensureServerNames();
      pickData = [{ v: "", label: "Авто — выбранный сервер", icon: "ti-wand" }].concat(
        serverNames.map(function (n) {
          return { v: n, label: cleanName(n), flag: flagCode(n) };
        }),
      );
    } else {
      var list = await realGeoSites();
      pickData = list.map(function (g) {
        var b = BRAND[g.replace("category-", "")];
        return { v: g, label: g, icon: b ? b[0] : "ti-world-search", color: b ? b[1] : null };
      });
    }
    renderPick();
  }
  $("rmPick").onclick = function () {
    openPicker(getChip("rmTypeChips"));
  };
  if ($("rmAllTraffic"))
    $("rmAllTraffic").onclick = function () {
      $("rmValue").value = "0.0.0.0/0";
      if (!$("rmName").value.trim()) $("rmName").value = "Весь трафик";
      updateValueField();
    };
  $("rmProxySelect").onclick = function () {
    openPicker("server");
  };
  $("pickSearch").oninput = function () {
    renderPick();
  };
  $("pickClose").onclick = function () {
    $("pickModal").classList.remove("show");
  };
  $("pickModal").onclick = function (e) {
    if (e.target === this) this.classList.remove("show");
  };
  function openRuleModal(idx) {
    editIdx = typeof idx === "number" ? idx : -1;
    editRef = editIdx >= 0 ? rulesData[editIdx] : null;
    var r = editRef || { type: "process", name: "", value: "", action: "vpn", proxy: "" };
    $("rmTitle").textContent = editIdx >= 0 ? "Изменить правило" : "Новое правило";
    $("rmName").value = r.name;
    $("rmValue").value = r.value;
    setChip("rmTypeChips", r.type);
    setChip("rmActionChips", r.action === "block" ? "no" : r.action);
    updateValueField();
    toggleProxyField();
    setProxyDisplay(r.proxy || "");
    clearRuleErr();
    $("ruleModal").classList.add("show");
  }
  $("ruleAdd").onclick = function () {
    openRuleModal();
  };
  $("rmCancel").onclick = function () {
    $("ruleModal").classList.remove("show");
  };
  $("ruleModal").onclick = function (e) {
    if (e.target === this) this.classList.remove("show");
  };
  function showRuleErr(msg, suggest) {
    var box = $("rmErr");
    if (!box) {
      toast(msg);
      return;
    }
    box.innerHTML =
      '<i class="ti ti-alert-triangle"></i><div>' +
      esc(msg) +
      (suggest ? ' <b id="rmFix">Подставить «' + esc(suggest) + "»</b>" : "") +
      "</div>";
    box.style.display = "flex";
    $("rmValue").classList.add("bad");
    if (suggest && $("rmFix"))
      $("rmFix").onclick = function () {
        $("rmValue").value = suggest;
        clearRuleErr();
      };
  }
  function clearRuleErr() {
    var box = $("rmErr");
    if (box) {
      box.style.display = "none";
      box.innerHTML = "";
    }
    $("rmValue").classList.remove("bad");
  }
  $("rmValue").addEventListener("input", clearRuleErr);
  $("rmSave").onclick = async function () {
    var btn = this;
    var rmType = getChip("rmTypeChips"),
      rmValue = $("rmValue").value.trim();
    var autoName = rmType === "process" ? rmValue.replace(/\.exe$/i, "") : rmValue;
    var r = {
      type: rmType,
      name: $("rmName").value.trim() || autoName || "Без названия",
      value: rmValue,
      action: getChip("rmActionChips"),
      enabled: true,
    };
    if (r.action === "vpn" && rmProxyValue) r.proxy = rmProxyValue;
    if (!r.value) {
      showRuleErr("Укажите значение");
      return;
    }
    if (api.validateRule) {
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = "Проверка…";
      var v;
      try {
        v = await api.validateRule({ type: r.type, value: r.value });
      } catch (e) {
        v = { ok: true };
      }
      btn.disabled = false;
      btn.textContent = old;
      if (v && !v.ok) {
        showRuleErr(v.error || "Некорректное значение", v.suggest);
        return;
      }
    }
    clearRuleErr();
    if (editIdx >= 0) {
      var pos = editRef ? rulesData.indexOf(editRef) : -1;
      if (pos >= 0) rulesData[pos] = r;
      else if (editIdx < rulesData.length) rulesData[editIdx] = r;
      else rulesData.unshift(r);
    } else rulesData.unshift(r);
    $("ruleModal").classList.remove("show");
    renderRules();
    persistRules();
    toast(editIdx >= 0 ? "Сохранено ✓" : "Правило добавлено ✓");
  };
  $("addset").onclick = function () {
    var preset = [
      ["process", "Дискорд", "discord.exe"],
      ["process", "Дискорд (Update)", "update.exe"],
      ["process", "Telegram", "Telegram.exe"],
      ["geoSite", "Smart: Youtube", "youtube"],
      ["geoSite", "Smart: Telegram", "telegram"],
      ["geoSite", "Smart: Twitter", "twitter"],
      ["geoSite", "Smart: Facebook", "facebook"],
      ["geoSite", "Smart: Instagram", "instagram"],
      ["geoSite", "Smart: Discord", "discord"],
      ["geoSite", "Smart: Openai", "openai"],
      ["geoSite", "Smart: Google", "google"],
      ["geoSite", "Smart: Tiktok", "tiktok"],
      ["geoSite", "Smart: Twitch", "twitch"],
      ["geoSite", "Smart: Netflix", "netflix"],
      ["geoSite", "Smart: Anthropic", "anthropic"],
      ["geoIp", "GeoIP: Telegram", "telegram"],
    ];
    var added = 0;
    preset.forEach(function (p) {
      if (
        !rulesData.some(function (x) {
          return x.type === p[0] && x.value === p[2];
        })
      ) {
        rulesData.push({ type: p[0], name: p[1], value: p[2], action: "vpn" });
        added++;
      }
    });
    renderRules();
    persistRules();
    this.textContent = added ? "Добавлено " + added + " ✓" : "Уже добавлены";
    var b = this;
    setTimeout(function () {
      b.textContent = "Добавить набор";
    }, 2e3);
  };
  $("ruleExport").onclick = function () {
    var out = rulesData.map(ruleObjToStr).filter(Boolean);
    var blob = new Blob([JSON.stringify(out)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "snowvpn-rules.json";
    a.click();
    toast("Экспортировано ✓");
  };
  $("ruleImport").onclick = function () {
    $("importFile").click();
  };
  $("importFile").onchange = function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var arr = JSON.parse(rd.result);
        if (!Array.isArray(arr)) {
          toast("Неверный формат");
          return;
        }
        var imported;
        if (arr.length && typeof arr[0] === "string") {
          imported = arr.map(ruleStrToObj).filter(Boolean);
        } else {
          var KNOWN_TYPES = {
            process: 1,
            domainSuffix: 1,
            domainKeyword: 1,
            geoSite: 1,
            geoIp: 1,
            ipCidr: 1,
          };
          imported = arr
            .filter(function (r) {
              return r && typeof r === "object" && r.value;
            })
            .map(function (r) {
              return {
                type: KNOWN_TYPES[r.type] ? r.type : "domainSuffix",
                name: String(r.name || r.value),
                value: String(r.value),
                action:
                  r.action === "vpn" || r.action === "no" || r.action === "block"
                    ? r.action
                    : "vpn",
                proxy: typeof r.proxy === "string" ? r.proxy : undefined,
                enabled: r.enabled !== false,
              };
            });
        }
        rulesData = imported;
        renderRules();
        persistRules();
        toast("Импортировано " + imported.length + " ✓");
      } catch (err) {
        toast("Ошибка чтения файла");
      }
    };
    rd.readAsText(f);
    e.target.value = "";
  };
  if ($("ruleSearch"))
    $("ruleSearch").oninput = function () {
      renderRules();
    };
  var appsData = null,
    appIconMem = {};
  function appRuleIdx(exe) {
    var low = String(exe || "").toLowerCase();
    for (var i = 0; i < rulesData.length; i++) {
      var r = rulesData[i];
      if (r && r.type === "process" && String(r.value || "").toLowerCase() === low) return i;
    }
    return -1;
  }
  function appMode(exe) {
    var i = appRuleIdx(exe);
    if (i < 0) return "auto";
    var r = rulesData[i];
    if (r.enabled === false) return "auto";
    return r.action === "no" ? "no" : "vpn";
  }
  function setAppMode(a, mode) {
    var i = appRuleIdx(a.exe);
    if (mode === "auto") {
      if (i >= 0) rulesData.splice(i, 1);
    } else if (i >= 0) {
      rulesData[i].action = mode;
      rulesData[i].enabled = true;
      delete rulesData[i].invalid;
      delete rulesData[i].invalidReason;
    } else
      rulesData.unshift({
        type: "process",
        name: a.name || a.exe,
        value: a.exe,
        action: mode,
        enabled: true,
      });
    renderRules();
    persistRules();
    renderApps();
  }
  function renderApps() {
    var box = $("appsList");
    if (!box) return;
    var q = ($("appsSearch").value || "").toLowerCase();
    box.innerHTML = "";
    if (!appsData) {
      box.innerHTML =
        '<div class="empty" style="padding:26px"><div class="es">Собираю список программ…</div></div>';
      return;
    }
    var shown = appsData.filter(function (a) {
      return !q || a.name.toLowerCase().indexOf(q) >= 0 || a.exe.toLowerCase().indexOf(q) >= 0;
    });
    shown = shown
      .slice()
      .sort(function (x, y) {
        var rx = appMode(x.exe) !== "auto" ? 0 : x.running ? 1 : 2;
        var ry = appMode(y.exe) !== "auto" ? 0 : y.running ? 1 : 2;
        return rx - ry;
      })
      .slice(0, 400);
    if (!shown.length) {
      box.innerHTML =
        '<div class="empty" style="padding:26px"><div class="es">Ничего не найдено</div></div>';
      return;
    }
    shown.forEach(function (a) {
      var mode = appMode(a.exe);
      var d = document.createElement("div");
      d.className = "approw";
      d.innerHTML =
        '<div class="aico"><i class="ti ti-app-window"></i></div>' +
        '<div class="at"><div class="a">' +
        esc(a.name) +
        (a.running ? '<span class="aprun" title="Сейчас запущено"></span>' : "") +
        '</div><div class="b">' +
        esc(a.exe) +
        "</div></div>" +
        '<div class="appseg">' +
        '<div class="sopt' +
        (mode === "auto" ? " on dir" : "") +
        '" data-m="auto" title="Без правила — как весь трафик">Авто</div>' +
        '<div class="sopt' +
        (mode === "vpn" ? " on" : "") +
        '" data-m="vpn" title="Трафик программы — через VPN">VPN</div>' +
        '<div class="sopt' +
        (mode === "no" ? " on dir" : "") +
        '" data-m="no" title="Трафик программы — мимо VPN, напрямую">Прямо</div>' +
        "</div>";
      d.querySelectorAll(".sopt").forEach(function (s) {
        s.onclick = function () {
          if (s.dataset.m !== appMode(a.exe)) {
            setAppMode(a, s.dataset.m);
            toast(
              (a.name || a.exe) +
                ": " +
                (s.dataset.m === "auto"
                  ? "как весь трафик"
                  : s.dataset.m === "vpn"
                    ? "через VPN ✓"
                    : "напрямую ✓"),
            );
          }
        };
      });
      if (a.path) {
        var ic = d.querySelector(".aico");
        if (appIconMem[a.path] !== undefined) {
          if (appIconMem[a.path]) ic.innerHTML = '<img src="' + appIconMem[a.path] + '">';
        } else if (api.appIcon)
          api
            .appIcon(a.path)
            .then(function (u) {
              appIconMem[a.path] = u || null;
              if (u && ic.isConnected) ic.innerHTML = '<img src="' + u + '">';
            })
            .catch(function () {});
      }
      box.appendChild(d);
    });
  }
  async function openApps() {
    $("appsModal").classList.add("show");
    $("appsWarn").style.display = curRouteMode === "global" ? "flex" : "none";
    $("appsSearch").value = "";
    renderApps();
    if (!appsData && api.appsList) {
      try {
        appsData = await api.appsList();
      } catch (e) {
        appsData = [];
      }
      renderApps();
    }
  }
  if ($("appsOpen")) $("appsOpen").onclick = openApps;
  if ($("appsClose"))
    $("appsClose").onclick = function () {
      $("appsModal").classList.remove("show");
    };
  if ($("appsModal"))
    $("appsModal").onclick = function (e) {
      if (e.target === this) this.classList.remove("show");
    };
  if ($("appsSearch"))
    $("appsSearch").oninput = function () {
      renderApps();
    };
  if ($("appsFixMode"))
    $("appsFixMode").onclick = async function () {
      syncRoute("rule");
      if (api.setRouteMode) await api.setRouteMode("rule");
      $("appsWarn").style.display = "none";
      toast("Режим «По приложениям» включён ✓");
    };
  var S = {
    theme: "dark",
    glass: true,
    blur: 40,
    anim: true,
    accent: { c: "#3df0e6", g: "linear-gradient(135deg,#41f0e0,#41a0ff)" },
  };
  function persist(patch) {
    Object.assign(S, patch);
    if (api.saveSettings) api.saveSettings(patch);
  }
  function setGlassStrength(v) {
    if (body.classList.contains("light")) {
      var al = (0.95 - (v / 100) * 0.55).toFixed(2);
      root.style.setProperty("--win-bg", "rgba(255,255,255," + al + ")");
    } else if (body.classList.contains("oled")) {
      var ao = (0.92 - (v / 100) * 0.62).toFixed(2);
      root.style.setProperty("--win-bg", "rgba(0,0,0," + ao + ")");
    } else {
      var a = (0.92 - (v / 100) * 0.62).toFixed(2);
      root.style.setProperty("--win-bg", "rgba(10,24,32," + a + ")");
    }
    var blurPx = Math.round(8 + (v / 100) * 44);
    root.style.setProperty("--blur", "blur(" + blurPx + "px) saturate(160%)");
    var bp = $("bgphoto");
    if (bp && body.classList.contains("hasbg"))
      bp.style.opacity = (0.25 + (v / 100) * 0.7).toFixed(2);
  }
  function applyTheme(s) {
    body.classList.toggle("light", s.theme === "light");
    body.classList.toggle("solid", s.glass === false);
    if (s.accent) {
      var ac = s.accent.c || s.accent;
      root.style.setProperty("--cy", ac);
      if (s.accent.g) root.style.setProperty("--grad", s.accent.g);
      root.style.setProperty("--onc", accentOnColor(ac));
      if ($("customAccent") && /^#[0-9a-fA-F]{6}$/.test(ac)) $("customAccent").value = ac;
      var matched = false;
      document.querySelectorAll("#swatches .swatch").forEach(function (x) {
        var isMatch = x.dataset.c && x.dataset.c.toLowerCase() === String(ac).toLowerCase();
        x.classList.toggle("on", isMatch);
        if (isMatch) matched = true;
      });
      if (!matched)
        document.querySelectorAll("#swatches .swatch").forEach(function (x) {
          x.classList.remove("on");
        });
    }
    document.querySelectorAll("#themeSeg button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.t === (s.theme || "dark"));
    });
    var rstyle = s.rulesStyle === "cards" ? "cards" : "list";
    body.classList.toggle("rules2", rstyle === "cards");
    document.querySelectorAll("#rstyleSeg button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.v === rstyle);
    });
    body.classList.toggle("nativeframe", !!s.nativeFrame);
    if ($("nativeFrameSw")) $("nativeFrameSw").classList.toggle("on", !!s.nativeFrame);
    $("glassSw").classList.toggle("on", s.glass !== false);
    $("blurRange").value = typeof s.blur === "number" ? s.blur : 40;
    body.classList.toggle("oled", !!s.oled);
    $("oledSw").classList.toggle("on", !!s.oled);
    if (s.glass !== false) setGlassStrength(typeof s.blur === "number" ? s.blur : 40);
    body.classList.toggle("anim", s.anim !== false);
    $("animSw").classList.toggle("on", s.anim !== false);
    body.classList.toggle("sidecollapsed", !!s.sideCollapsed);
    $("autoConnSw").classList.toggle("on", !!s.autoConnect);
    if ($("reconnSw")) $("reconnSw").classList.toggle("on", s.autoReconnect !== false);
    $("lanSw").classList.toggle("on", !!s.allowLan);
    $("quietSw").classList.toggle("on", !!s.startMinimized);
    $("closeTraySw").classList.toggle("on", s.closeToTray !== false);
    applyBg(s.bgImage);
    applyAvatar(s.avatarImage);
  }
  document.querySelectorAll(".setrow .sw").forEach(function (s) {
    if (s.id) return;
    s.onclick = function () {
      s.classList.toggle("on");
      toast(s.classList.contains("on") ? "Включено" : "Выключено");
    };
  });
  $("glassSw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    body.classList.toggle("solid", !on);
    if (on) setGlassStrength(+$("blurRange").value);
    persist({ glass: on });
  };
  $("animSw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    body.classList.toggle("anim", on);
    persist({ anim: on });
    toast(on ? "Анимация фона включена" : "Анимация выключена — max FPS");
  };
  $("oledSw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    body.classList.toggle("oled", on);
    if (!body.classList.contains("solid")) setGlassStrength(+$("blurRange").value);
    persist({ oled: on });
    toast(on ? "Чистый чёрный включён" : "Чистый чёрный выключен");
  };
  if ($("sideToggle"))
    $("sideToggle").onclick = function () {
      var c = body.classList.toggle("sidecollapsed");
      persist({ sideCollapsed: c });
    };
  function updOverlay(text) {
    var o = $("updOverlay");
    if (!o) return;
    if (!text) {
      o.style.display = "none";
      return;
    }
    var t = $("updOverlayText");
    if (t) t.textContent = text;
    o.style.display = "flex";
  }
  if (api.onUpdateProgress)
    api.onUpdateProgress(function (d) {
      var lbl = $("updLbl");
      if (!lbl) return;
      if (d.error) {
        updOverlay(null);
        lbl.textContent = "Ошибка: " + d.error;
        return;
      }
      if (d.stage) {
        var st = {
          extract: "Распаковываем обновление…",
          apply: "Устанавливаем обновление…",
          restart: "Готово — перезапускаемся…",
        }[d.stage];
        if (st) {
          lbl.textContent = st;
          updOverlay(st);
        }
        return;
      }
      if (d.deferred) {
        updOverlay(null);
        lbl.textContent = "Обновление установится при следующем запуске";
        toast("Обновление отложено");
        try {
          refreshPending();
        } catch (_) {}
        return;
      }
      if (d.cancelled) {
        updOverlay(null);
        lbl.textContent = "Установка отменена (обновление загружено)";
        return;
      }
      if (d.ready) {
        updOverlay(null);
        lbl.textContent = "Загружено — выберите вариант установки…";
        return;
      }
      var mb = function (b) {
        return ((b || 0) / 1048576).toFixed(0);
      };
      var txt =
        "Скачивание " +
        (d.pct || 0) +
        "%" +
        (d.total ? " · " + mb(d.received) + "/" + mb(d.total) + " МБ" : "…");
      lbl.textContent = txt;
      updOverlay(txt);
    });
  function askUpdateConfirm(r) {
    return new Promise(function (resolve) {
      var m = $("updConfirmModal");
      if (!m) {
        resolve(true);
        return;
      }
      if ($("ucfVer")) $("ucfVer").textContent = "v" + r.version;
      var raw = String(r.changelog || "")
        .replace(/^Что нового:\s*\r?\n?/i, "")
        .trim();
      var items = [];
      raw.split(/\r?\n/).forEach(function (line) {
        var s = String(line).trim();
        if (!s) return;
        if (/^[•*-]\s*/.test(s)) items.push(s.replace(/^[•*-]\s*/, "").trim());
        else if (items.length) items[items.length - 1] += " " + s;
        else items.push(s);
      });
      var body = $("ucfNotes");
      if (body) {
        body.innerHTML = items.length
          ? items
              .map(function (t) {
                return (
                  '<div class="ucfli"><i class="ti ti-point-filled"></i><div>' +
                  esc(t) +
                  "</div></div>"
                );
              })
              .join("")
          : '<div class="ucfli"><i class="ti ti-point-filled"></i><div>Улучшения и исправления</div></div>';
      }
      m.classList.add("show");
      var done = function (v) {
        m.classList.remove("show");
        resolve(v);
      };
      if ($("ucfLater"))
        $("ucfLater").onclick = function () {
          done(false);
        };
      if ($("ucfInstall"))
        $("ucfInstall").onclick = function () {
          done(true);
        };
      m.onclick = function (e) {
        if (e.target === m) done(false);
      };
    });
  }
  async function runUpdate(r, skipConfirm) {
    var proceed = skipConfirm || (await askUpdateConfirm(r));
    if (!proceed) return;
    hideUpdateBanner();
    if ($("updLbl")) $("updLbl").textContent = "Подключение к серверу…";
    updOverlay("Получаем данные обновления…");
    var ir = null;
    if (r.appUrl && api.updateDelta) {
      ir = await api.updateDelta(r.appUrl, r.appRuntime);
      if (ir && ir.needFull) ir = null;
    }
    if (!ir) ir = api.updateInstall ? await api.updateInstall(r.url) : { ok: false };
    if (!ir.ok && !ir.deferred && !ir.cancelled) {
      updOverlay(null);
      if ($("updLbl"))
        $("updLbl").textContent = "Ошибка загрузки: " + (ir.error || "нет соединения");
      toast("Не удалось загрузить: " + (ir.error || ""));
    }
  }
  var pendingUpdate = null;
  function showUpdateBanner(r) {
    pendingUpdate = r;
    if ($("updBannerTitle")) $("updBannerTitle").textContent = "Доступно обновление " + r.version;
    if ($("updBannerSub"))
      $("updBannerSub").textContent =
        (r.changelog
          ? String(r.changelog)
              .split("\n")[0]
              .replace(/^Что нового:\s*/i, "")
              .trim()
          : "Улучшения и исправления") || "Улучшения и исправления";
    if ($("updBanner")) $("updBanner").style.display = "flex";
  }
  function hideUpdateBanner() {
    if ($("updBanner")) $("updBanner").style.display = "none";
    pendingUpdate = null;
  }
  if ($("updBannerBtn"))
    $("updBannerBtn").onclick = function () {
      if (pendingUpdate) runUpdate(pendingUpdate, false);
    };
  if ($("updBannerClose"))
    $("updBannerClose").onclick = function () {
      hideUpdateBanner();
      if (pendingUpdate) persist({ updateSnoozed: pendingUpdate.version });
    };
  if ($("updBtn"))
    $("updBtn").onclick = async function (e) {
      if (e) e.stopPropagation();
      $("updLbl").textContent = "Проверяю…";
      var r = api.updateCheck ? await api.updateCheck() : { ok: false };
      try {
        loadUpdatesTab();
      } catch (_) {}
      if (!r.ok) {
        $("updLbl").textContent = "Не удалось проверить";
        toast("Сервер обновлений недоступен");
        return;
      }
      if (!r.available) {
        $("updLbl").textContent = "У вас последняя версия (" + r.current + ")";
        toast("Обновлений нет");
        return;
      }
      $("updLbl").textContent = "Доступна версия " + r.version;
      if (r.url) runUpdate(r);
    };
  $("blurRange").oninput = function () {
    if (!body.classList.contains("solid")) setGlassStrength(+this.value);
    persist({ blur: +this.value });
  };
  document.querySelectorAll("#themeSeg button").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#themeSeg button").forEach(function (x) {
        x.classList.remove("on");
      });
      this.classList.add("on");
      body.classList.toggle("light", this.dataset.t === "light");
      if (!body.classList.contains("solid")) setGlassStrength(+$("blurRange").value);
      persist({ theme: this.dataset.t });
    };
  });
  if ($("nativeFrameSw"))
    $("nativeFrameSw").onclick = function () {
      var on = !this.classList.contains("on");
      this.classList.toggle("on", on);
      body.classList.toggle("nativeframe", on);
      if (api.setNativeFrame) api.setNativeFrame(on);
      else toast("Обновите приложение, чтобы включить этот режим");
    };
  document.querySelectorAll("#rstyleSeg button").forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll("#rstyleSeg button").forEach(function (x) {
        x.classList.remove("on");
      });
      this.classList.add("on");
      body.classList.toggle("rules2", this.dataset.v === "cards");
      persist({ rulesStyle: this.dataset.v });
    };
  });
  document.querySelectorAll("#swatches .swatch").forEach(function (s) {
    s.onclick = function () {
      document.querySelectorAll("#swatches .swatch").forEach(function (x) {
        x.classList.remove("on");
      });
      this.classList.add("on");
      root.style.setProperty("--cy", this.dataset.c);
      root.style.setProperty("--grad", this.dataset.g);
      root.style.setProperty("--onc", accentOnColor(this.dataset.c));
      persist({ accent: { c: this.dataset.c, g: this.dataset.g } });
    };
  });
  function applyAccent(c, g) {
    g = g || "linear-gradient(135deg," + c + "," + c + ")";
    document.querySelectorAll("#swatches .swatch").forEach(function (x) {
      x.classList.remove("on");
    });
    root.style.setProperty("--cy", c);
    root.style.setProperty("--grad", g);
    root.style.setProperty("--onc", accentOnColor(c));
    persist({ accent: { c: c, g: g } });
  }
  if ($("customAccent"))
    $("customAccent").oninput = function () {
      applyAccent(this.value);
    };
  if ($("sysAccent"))
    $("sysAccent").onclick = async function () {
      if (!api.systemAccent) {
        toast("Недоступно");
        return;
      }
      try {
        var c = await api.systemAccent();
        if (c) {
          applyAccent(c);
          if ($("customAccent")) $("customAccent").value = c;
          toast("Цвет как в Windows: " + c);
        } else toast("Не удалось получить цвет");
      } catch (e) {
        toast("Ошибка");
      }
    };
  async function setNet(mode) {
    $("tunSw").classList.toggle("on", mode === "tun");
    $("proxySw").classList.toggle("on", mode === "proxy");
    $("stMode").textContent = mode === "tun" ? "TUN" : "Прокси";
    if (api.setNetMode) {
      var r = await api.setNetMode(mode);
      if (r && r.state) applyState(r.state);
    }
    toast(mode === "tun" ? "Режим: TUN (весь ПК)" : "Режим: системный прокси");
  }
  $("tunSw").onclick = function () {
    setNet("tun");
  };
  $("proxySw").onclick = function () {
    setNet("proxy");
  };
  $("aiSw").onclick = async function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    if (api.aiSet) {
      var r = await api.aiSet(on);
      if (!r || !r.ok) {
        this.classList.toggle("on", !on);
        toast("Ошибка: " + ((r && r.error) || "Не удалось применить AI-DNS"));
      } else {
        document.querySelectorAll('.qchip[data-q="ai"]').forEach(function (x) {
          x.classList.toggle("on", on);
        });
        if ($("aiDnsRegionRow")) $("aiDnsRegionRow").style.display = on ? "" : "none";
        toast(r.warning || (on ? "Настройка AI-DNS применена" : "AI-DNS выключен"));
      }
    } else toast(on ? "AI-DNS включён" : "AI-DNS выключен");
  };
  $("autoSw").onclick = async function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    if (api.autostartSet) await api.autostartSet(on);
    toast(on ? "Автозапуск включён" : "Автозапуск выключен");
  };
  if ($("adminSw"))
    $("adminSw").onclick = async function () {
      this.classList.toggle("on");
      var on = this.classList.contains("on");
      var ok = api.adminSetAlways ? await api.adminSetAlways(on) : false;
      if (!ok) {
        toast("Не удалось изменить");
        return;
      }
      if (on) {
        var amAdmin = api.isAdmin ? await api.isAdmin() : true;
        if (!amAdmin) {
          if (
            confirm(
              "Запуск от админа включён.\nПерезапустить приложение сейчас от имени администратора?",
            )
          ) {
            if (api.relaunchAdmin) await api.relaunchAdmin();
          } else {
            toast("Применится при следующем запуске");
          }
        } else {
          toast("Включено — уже запущено от админа");
        }
      } else {
        toast("Запуск от админа выключен");
      }
    };
  var curHotkey = "CommandOrControl+Alt+S",
    hotRecording = false;
  function prettyHotkey(acc) {
    return String(acc || "")
      .replace("CommandOrControl", "Ctrl")
      .replace("Control", "Ctrl")
      .replace("Super", "Win")
      .split("+")
      .join("+");
  }
  function setHotLabel() {
    if ($("hotLbl"))
      $("hotLbl").textContent =
        prettyHotkey(curHotkey) + " — подключение/отключение · Ctrl+Alt+N — следующий сервер";
  }
  $("hotSw").onclick = async function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    if (api.hotkeySet) await api.hotkeySet(curHotkey, on);
    toast(on ? "Хоткей включён: " + prettyHotkey(curHotkey) : "Хоткей выключен");
  };
  if ($("hotLbl")) {
    $("hotLbl").style.cursor = "pointer";
    $("hotLbl").title = "Кликни и нажми своё сочетание (Esc — отмена)";
    $("hotLbl").onclick = function () {
      hotRecording = true;
      $("hotLbl").textContent = "Нажмите сочетание клавиш… (Esc — отмена)";
    };
  }
  window.addEventListener(
    "keydown",
    async function (e) {
      if (!hotRecording) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        hotRecording = false;
        setHotLabel();
        return;
      }
      var k = e.key;
      if (k === "Control" || k === "Alt" || k === "Shift" || k === "Meta") return;
      var mods = [];
      if (e.ctrlKey) mods.push("Control");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      if (!mods.length) {
        toast("Добавьте модификатор: Ctrl / Alt / Shift");
        return;
      }
      if (k.length === 1) k = k.toUpperCase();
      else if (/^f\d+$/i.test(k)) k = k.toUpperCase();
      else if (k === " ") k = "Space";
      var acc = mods.concat([k]).join("+");
      curHotkey = acc;
      hotRecording = false;
      $("hotSw").classList.add("on");
      if (api.hotkeySet) await api.hotkeySet(acc, true);
      setHotLabel();
      toast("Хоткей назначен: " + prettyHotkey(acc));
    },
    true,
  );
  $("autoConnSw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    persist({ autoConnect: on });
    toast(on ? "Автоподключение включено" : "Автоподключение выключено");
  };
  if ($("reconnSw"))
    $("reconnSw").onclick = function () {
      this.classList.toggle("on");
      var on = this.classList.contains("on");
      persist({ autoReconnect: on });
      toast(on ? "Авто-переподключение включено" : "Авто-переподключение выключено");
    };
  $("lanSw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    persist({ allowLan: on });
    toast(on ? "LAN разрешён (применится при подключении)" : "LAN запрещён");
  };
  $("quietSw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    persist({ startMinimized: on });
    toast(on ? "Тихий запуск включён" : "Тихий запуск выключен");
  };
  $("closeTraySw").onclick = function () {
    this.classList.toggle("on");
    var on = this.classList.contains("on");
    persist({ closeToTray: on });
    toast(on ? "Закрытие сворачивает в трей" : "Закрытие = полный выход");
  };
  function applyBg(p) {
    var el = $("bgphoto");
    if (p) {
      el.style.backgroundImage =
        'url("file:///' + p.replace(/\\/g, "/") + "?t=" + Date.now() + '")';
      el.classList.add("on");
      body.classList.add("hasbg");
    } else {
      el.style.backgroundImage = "";
      el.classList.remove("on");
      body.classList.remove("hasbg");
      el.style.opacity = "";
    }
    if (!body.classList.contains("solid")) {
      var _bv =
        $("blurRange") && $("blurRange").value !== ""
          ? +$("blurRange").value
          : typeof S.blur === "number"
            ? S.blur
            : 40;
      setGlassStrength(_bv);
    }
  }
  $("bgPick").onclick = async function () {
    if (!api.bgPick) return;
    var r = await api.bgPick();
    if (r && r.ok) {
      applyBg(r.path);
      persist({ bgImage: r.path });
      toast("Фон установлен");
    }
  };
  $("bgClear").onclick = async function () {
    if (api.bgClear) await api.bgClear();
    applyBg(null);
    persist({ bgImage: null });
    toast("Фон убран");
  };
  var AVATAR_DEFAULT = "../assets/knuckles.jpg";
  function applyAvatar(p) {
    var src = p ? "file:///" + p.replace(/\\/g, "/") + "?t=" + Date.now() : AVATAR_DEFAULT;
    if ($("avImg")) $("avImg").src = src;
  }
  if ($("avatarPick"))
    $("avatarPick").onclick = async function () {
      if (!api.avatarPick) return;
      var r = await api.avatarPick();
      if (r && r.ok) {
        applyAvatar(r.path);
        persist({ avatarImage: r.path });
        toast("Аватар установлен");
      }
    };
  if ($("avatarClear"))
    $("avatarClear").onclick = async function () {
      if (api.avatarClear) await api.avatarClear();
      applyAvatar(null);
      persist({ avatarImage: null });
      toast("Аватар сброшен");
    };
  if ($("sideAvatar"))
    $("sideAvatar").onclick = function () {
      $("avImgFull").src = $("avImg").src;
      $("avatarModal").classList.add("show");
    };
  if ($("avatarClose"))
    $("avatarClose").onclick = function () {
      $("avatarModal").classList.remove("show");
    };
  if ($("avatarModal"))
    $("avatarModal").onclick = function (e) {
      if (e.target === this) this.classList.remove("show");
    };
  $("bkExport").onclick = async function () {
    if (!api.backupExport) return;
    var r = await api.backupExport();
    toast(r && r.ok ? "Копия сохранена ✓" : "Отменено");
  };
  $("bkImport").onclick = async function () {
    if (!api.backupImport) return;
    var r = await api.backupImport();
    if (r && r.ok) {
      toast("Восстановлено ✓");
      loadSub();
      loadServers();
      initSettings();
    } else toast("Отменено");
  };
  document.querySelectorAll(".setrow[data-act]").forEach(function (row) {
    row.onclick = async function () {
      var act = row.dataset.act;
      if (act === "journal") {
        openJournal();
      } else if (act === "connections") {
        openConnections();
      } else if (act === "stats") {
        openStats();
      } else if (act === "access") {
        go("rules");
        var appBtn = document.querySelector('#rgrp button[data-m="app"]');
        if (appBtn) appBtn.click();
      } else if (act === "folder") {
        if (api.openConfigFolder) api.openConfigFolder();
      } else if (act === "faq") {
        openFAQ();
      } else if (act === "selfcheck") {
        openSelfCheck();
      } else if (act === "about") {
        var a = api.about ? await api.about() : {};
        toast(
          "SnowVPN v" +
            (a.version || "") +
            " · " +
            (a.core || "mihomo 1.19.27") +
            (a.admin ? " · админ" : ""),
        );
      } else if (act === "factoryReset") {
        if (!api.factoryReset) return;
        var r = await api.factoryReset();
        if (r && r.ok === false && !r.error) {
        } else if (r && r.error) toast("Не удалось сбросить: " + r.error);
      }
    };
  });
  function setTab(name) {
    var bar = $("setTabs");
    if (!bar) return;
    bar.querySelectorAll(".stab-btn").forEach(function (b) {
      b.classList.toggle("on", b.dataset.tab === name);
    });
    var all = name === "all";
    document.querySelectorAll(".stab").forEach(function (p) {
      p.classList.toggle("on", all || p.dataset.stab === name);
    });
    if (name === "upd" || all) {
      try {
        loadUpdatesTab();
      } catch (_) {}
      try {
        refreshPending();
      } catch (_) {}
    }
  }
  (function () {
    var inp = $("setSearch");
    if (!inp) return;
    var clr = $("setSearchClear"),
      empty = $("setNoFound"),
      tabs = $("setTabs");
    function norm(s) {
      return (s || "").toLowerCase().replace(/ё/g, "е");
    }
    function run() {
      var q = norm(inp.value.trim());
      if (clr) clr.style.display = q ? "" : "none";
      var rows = document.querySelectorAll("#setTabs ~ .stab .setrow, .stab .setrow");
      if (!q) {
        if (tabs) tabs.style.display = "";
        rows.forEach(function (r) {
          r.style.display = "";
        });
        document.querySelectorAll(".stab > *").forEach(function (e) {
          e.style.display = "";
        });
        if (empty) empty.style.display = "none";
        var act = document.querySelector("#setTabs .stab-btn.on");
        setTab(act ? act.dataset.tab : "look");
        return;
      }
      if (tabs) tabs.style.display = "none";
      document.querySelectorAll(".stab").forEach(function (p) {
        p.classList.add("on");
      });
      var found = 0;
      document.querySelectorAll(".stab").forEach(function (p) {
        Array.prototype.forEach.call(p.children, function (el) {
          if (el.classList.contains("setrow")) {
            var hit = norm(el.textContent).indexOf(q) >= 0;
            el.style.display = hit ? "" : "none";
            if (hit) found++;
          } else {
            el.style.display = "none";
          }
        });
      });
      if (empty) {
        empty.style.display = found ? "none" : "";
        empty.textContent = found ? "" : "Ничего не найдено по запросу «" + inp.value.trim() + "»";
      }
    }
    inp.oninput = run;
    if (clr)
      clr.onclick = function () {
        inp.value = "";
        run();
        inp.focus();
      };
    inp.onkeydown = function (e) {
      if (e.key === "Escape") {
        inp.value = "";
        run();
      }
    };
  })();
  (function () {
    var bar = $("setTabs");
    if (!bar) return;
    bar.querySelectorAll(".stab-btn").forEach(function (b) {
      b.onclick = function () {
        setTab(b.dataset.tab);
      };
    });
  })();
  var DIAG_ORDER = [
    ["core", "Ядро VPN"],
    ["admin", "Права администратора"],
    ["sub", "Подписка"],
    ["vpn", "Подключение"],
    ["net", "Сеть (TUN/прокси)"],
    ["dns", "DNS"],
    ["srv", "Сервер"],
    ["inet", "Интернет через VPN"],
    ["ip", "Внешний IP"],
  ];
  var DIAG_ICONS = { ok: "ti-check", fail: "ti-x", warn: "ti-alert-triangle" };
  var diagBusy = false;
  function escD(t) {
    var e = document.createElement("span");
    e.textContent = t == null ? "" : t;
    return e.innerHTML;
  }
  function diagRow(id, title) {
    var d = document.createElement("div");
    d.className = "dstep wait";
    d.id = "dstep-" + id;
    d.innerHTML =
      '<div class="dic"><i class="ti ti-loader-2 dspin"></i></div><div class="dt" style="flex:1;min-width:0"><div class="a">' +
      escD(title) +
      '</div><div class="b">Ожидание…</div></div>';
    return d;
  }
  function diagApply(s) {
    if (!s || !s.id) return;
    var d = $("dstep-" + s.id);
    if (!d) return;
    if (s.status === "skip") {
      d.remove();
      return;
    }
    d.className = "dstep " + s.status;
    var html =
      '<div class="dic"><i class="ti ' +
      (DIAG_ICONS[s.status] || "ti-check") +
      '"></i></div>' +
      '<div class="dt" style="flex:1;min-width:0"><div class="a">' +
      escD(s.title || "") +
      "</div>" +
      (s.detail ? '<div class="b">' + escD(s.detail) + "</div>" : "") +
      (s.hint
        ? '<div class="dhint"><i class="ti ti-bulb" style="margin-right:5px"></i>' +
          escD(s.hint) +
          "</div>"
        : "") +
      "</div>";
    d.innerHTML = html;
  }
  async function runSelfCheck() {
    if (diagBusy || !api.selfCheck) return;
    diagBusy = true;
    $("diagAgain").style.display = "none";
    $("diagSub").textContent = "Проверяем каждое звено по очереди…";
    var box = $("diagSteps");
    box.innerHTML = "";
    DIAG_ORDER.forEach(function (p) {
      box.appendChild(diagRow(p[0], p[1]));
    });
    var res = null;
    try {
      res = await api.selfCheck();
    } catch (e) {}
    diagBusy = false;
    if (res && Array.isArray(res.steps)) res.steps.forEach(diagApply);
    var firstFail =
      res && res.steps
        ? res.steps.find(function (s) {
            return s.status === "fail";
          })
        : null;
    if (firstFail)
      $("diagSub").textContent =
        "Найдена проблема: " + (firstFail.title || "") + " — смотрите подсказку ниже";
    else if (res && res.steps) $("diagSub").textContent = "Всё в порядке — все проверки пройдены ✓";
    else $("diagSub").textContent = "Не удалось выполнить проверку";
    $("diagAgain").style.display = "";
  }
  function openSelfCheck() {
    $("diagModal").classList.add("show");
    runSelfCheck();
  }
  if (api.onDiagStep) api.onDiagStep(diagApply);
  $("diagAgain").onclick = function () {
    runSelfCheck();
  };
  $("diagClose").onclick = function () {
    $("diagModal").classList.remove("show");
  };
  $("diagModal").onclick = function (e) {
    if (e.target === this) this.classList.remove("show");
  };
  var logLines = [],
    logActive = false;
  function fmtLog(line) {
    if (typeof line === "string") return line;
    if (line && line.payload) return "[" + (line.type || "log") + "] " + line.payload;
    return JSON.stringify(line);
  }
  if (api.onLog)
    api.onLog(function (line) {
      if (logLines.length > 500) logLines.shift();
      logLines.push(fmtLog(line));
      if (logActive) renderLog();
    });
  function renderLog() {
    var box = $("logBox");
    box.textContent = logLines.join("\n");
    box.scrollTop = box.scrollHeight;
  }
  function openJournal() {
    logActive = true;
    go("journal");
    renderLog();
  }
  $("jBack").onclick = function () {
    logActive = false;
    go("set");
  };
  $("jClear").onclick = function () {
    logLines = [];
    renderLog();
  };
  if ($("jCopy"))
    $("jCopy").onclick = async function () {
      var txt = logLines.join("\n");
      if (!txt) {
        toast("Логи пусты");
        return;
      }
      try {
        await navigator.clipboard.writeText(txt);
        toast("Логи скопированы ✓ (" + logLines.length + " строк)");
      } catch (e) {
        try {
          var ta = document.createElement("textarea");
          ta.value = txt;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          toast("Логи скопированы ✓");
        } catch (_) {
          toast("Не удалось скопировать");
        }
      }
    };
  var connTimer = null;
  async function refreshConn() {
    if (!api.connections) return;
    var c = await api.connections();
    var list = (c && c.connections) || [];
    var total = list.length;
    var q = (($("connSearch") || {}).value || "").trim().toLowerCase();
    if (q) {
      list = list.filter(function (cn) {
        var m = cn.metadata || {};
        return (
          (m.host || "").toLowerCase().indexOf(q) >= 0 ||
          (m.destinationIP || "").toLowerCase().indexOf(q) >= 0 ||
          (m.process || "").toLowerCase().indexOf(q) >= 0 ||
          (cn.chains || []).join(" ").toLowerCase().indexOf(q) >= 0
        );
      });
    }
    $("connSub").textContent =
      (q ? list.length + " из " + total : total + " активных") +
      " · ↓" +
      fmtBytes(c.downloadTotal) +
      " ↑" +
      fmtBytes(c.uploadTotal);
    var box = $("connBox");
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML =
        '<div class="empty"><i class="ti ti-plug-connected-x"></i><div class="et">' +
        (q ? "Ничего не найдено" : "Нет активных соединений") +
        '</div><div class="es">' +
        (q ? "Измените запрос" : "Подключитесь, чтобы увидеть трафик") +
        "</div></div>";
      return;
    }
    list.slice(0, 200).forEach(function (cn) {
      var meta = cn.metadata || {};
      var host = meta.host || meta.destinationIP || "—";
      var proc = meta.process ? " · " + meta.process : "";
      var chain = (cn.chains || []).slice().reverse().join(" → ");
      var d = document.createElement("div");
      d.className = "conn-item";
      d.innerHTML =
        '<i class="ti ti-world" style="color:var(--cy)"></i><div class="ci"><div class="a">' +
        esc(host) +
        (meta.destinationPort ? ":" + esc(meta.destinationPort) : "") +
        '</div><div class="b">' +
        esc(meta.network || "") +
        esc(proc) +
        " · " +
        esc(chain) +
        '</div></div><div class="cd">↓' +
        fmtBytes(cn.download) +
        "<br>↑" +
        fmtBytes(cn.upload) +
        "</div>";
      box.appendChild(d);
    });
  }
  function openConnections() {
    go("connections");
    refreshConn();
    clearInterval(connTimer);
    connTimer = setInterval(refreshConn, 1500);
  }
  async function openStats() {
    go("stats");
    var r = api.statsGet ? await api.statsGet() : null;
    if (!r) return;
    $("stSess").textContent = "↓ " + fmtBytes(r.session.down) + " · ↑ " + fmtBytes(r.session.up);
    $("stToday").textContent = "↓ " + fmtBytes(r.today.down) + " · ↑ " + fmtBytes(r.today.up);
    $("stAll").textContent = "↓ " + fmtBytes(r.allDown) + " · ↑ " + fmtBytes(r.allUp);
    var box = $("stDays");
    box.innerHTML = "";
    var days = (r.days || []).slice().reverse();
    if (!days.length) {
      box.innerHTML =
        '<div class="empty" style="padding:20px"><div class="es">Пока нет данных</div></div>';
      return;
    }
    var max = 1;
    days.forEach(function (d) {
      max = Math.max(max, (d.up || 0) + (d.down || 0));
    });
    days.forEach(function (d) {
      var dn = d.down || 0,
        up = d.up || 0;
      var dnPct = Math.round((dn / max) * 100),
        upPct = Math.round((up / max) * 100);
      var el = document.createElement("div");
      el.style.marginBottom = "10px";
      el.innerHTML =
        '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>' +
        d.date +
        '</span><span style="color:var(--dim)">↓' +
        fmtBytes(dn) +
        " ↑" +
        fmtBytes(up) +
        "</span></div>" +
        '<div style="height:8px;border-radius:6px;background:var(--panel2);display:flex;overflow:hidden">' +
        '<div style="height:100%;width:' +
        dnPct +
        '%;background:var(--grad)"></div>' +
        '<div style="height:100%;width:' +
        upPct +
        '%;background:var(--cy);opacity:.45"></div></div>';
      box.appendChild(el);
    });
    if (!$("stLegend")) {
      var lg = document.createElement("div");
      lg.id = "stLegend";
      lg.style.cssText = "font-size:12px;color:var(--dim);margin-top:6px";
      lg.innerHTML =
        '<span style="color:var(--cy)">▉</span> скачано · <span style="color:var(--cy);opacity:.55">▉</span> отдано';
      box.appendChild(lg);
    }
  }
  if ($("stBack"))
    $("stBack").onclick = function () {
      go("set");
    };
  function openFAQ() {
    go("faq");
  }
  if ($("faqBack"))
    $("faqBack").onclick = function () {
      go("set");
    };
  document.querySelectorAll(".faqitem .faqq").forEach(function (q) {
    q.onclick = function () {
      q.parentElement.classList.toggle("on");
    };
  });
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }
  function ruDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    return m ? m[3] + "." + m[2] + "." + m[1] : String(s || "");
  }
  async function refreshPending() {
    var box = $("pendBox");
    if (!box || !api.updPendingGet) return;
    var p = null;
    try {
      p = await api.updPendingGet();
    } catch (_) {}
    if (!p || !p.has) {
      box.style.display = "none";
      return;
    }
    var mb = p.size ? " · " + (p.size / 1048576).toFixed(0) + " МБ" : "";
    if ($("pendVer"))
      $("pendVer").textContent =
        (p.version ? "Версия " + p.version + " — установится" : "Установится") +
        " при следующем запуске" +
        mb;
    box.style.display = "flex";
  }
  if ($("pendNow"))
    $("pendNow").onclick = async function () {
      if (!api.updPendingRun) return;
      this.disabled = true;
      this.textContent = "Запускаю…";
      var r = await api.updPendingRun();
      if (!r || !r.ok) {
        this.disabled = false;
        this.textContent = "Установить сейчас";
        toast("Не удалось: " + ((r && r.error) || "файл не найден"));
        refreshPending();
      }
    };
  if ($("pendDrop"))
    $("pendDrop").onclick = async function () {
      if (!api.updPendingDrop) return;
      await api.updPendingDrop();
      toast("Загруженное обновление удалено");
      refreshPending();
    };
  var updBusy = false;
  async function loadUpdatesTab() {
    var box = $("uList");
    if (!box || updBusy) return;
    updBusy = true;
    try {
      if (!box.querySelector(".vrow"))
        box.innerHTML =
          '<div style="color:var(--dim);font-size:12.5px;padding:8px 2px">Загружаем историю версий…</div>';
      var cur = "";
      try {
        if (api.about) {
          var ab = await api.about();
          cur = ab.version || "";
        }
      } catch (_) {}
      if ($("uNowVer")) $("uNowVer").textContent = "SnowVPN" + (cur ? " v" + cur : "");
      if (!api.updateChangelog) {
        box.innerHTML = "";
        return;
      }
      var r = await api.updateChangelog();
      if (!r || !r.ok || !r.list || !r.list.length) {
        if (!box.querySelector(".vrow"))
          box.innerHTML =
            '<div class="empty" style="padding:28px 0"><i class="ti ti-cloud-off"></i><div class="et">История недоступна</div><div class="es">Не удалось загрузить список версий с сервера</div></div>';
        return;
      }
      var newer = r.list.filter(function (x) {
        return x.isNew;
      }).length;
      if ($("uSub"))
        $("uSub").textContent = newer
          ? "История версий · новее вашей: " + newer
          : "История версий · у вас последняя";
      box.innerHTML = r.list
        .map(function (v) {
          var isCur = v.version === (cur || r.current);
          var cls = "vrow" + (v.isNew ? " vnew" : isCur ? " vcur" : "");
          var tag = v.isNew
            ? '<span class="vtag n">новое</span>'
            : isCur
              ? '<span class="vtag c">у вас</span>'
              : "";
          return (
            '<div class="' +
            cls +
            '"><div class="vhead"><span class="vver">v' +
            esc(v.version) +
            "</span>" +
            tag +
            (v.date ? '<span class="vdate">' + esc(ruDate(v.date)) + "</span>" : "") +
            "</div>" +
            '<div class="vnotes">' +
            esc(v.notes) +
            "</div></div>"
          );
        })
        .join("");
    } finally {
      updBusy = false;
    }
  }
  async function openFavPopup() {
    var m = $("favModal"),
      box = $("favList");
    if (!m || !box) return;
    m.classList.add("show");
    box.innerHTML = '<div class="favempty">Загружаем…</div>';
    var favs = [];
    try {
      favs = (await api.favList()) || [];
    } catch (_) {}
    if (!favs.length) {
      box.innerHTML =
        '<div class="favempty">Здесь пока пусто.<br>Откройте «Серверы» и отметьте нужные звёздочкой ★ —<br>они появятся тут для быстрого переключения.</div>';
      return;
    }
    var byName = {},
      cur = "",
      gotList = false;
    try {
      var r = await api.proxyGroups();
      var g = ((r && r.groups) || []).find(function (x) {
        return x.name !== "GLOBAL";
      });
      if (g) {
        cur = g.now || "";
        (g.all || []).forEach(function (p) {
          byName[p.name] = p;
        });
        gotList = (g.all || []).length > 0;
      }
    } catch (_) {}
    if (gotList)
      favs = favs.filter(function (n) {
        return !!byName[n];
      });
    if (!favs.length) {
      box.innerHTML =
        '<div class="favempty">Избранных серверов из этой подписки сейчас нет.<br>Похоже, их убрали у провайдера.<br>Откройте «Серверы» и отметьте другие звёздочкой ★.</div>';
      return;
    }
    box.innerHTML = "";
    favs.forEach(function (name) {
      var p = byName[name] || { name: name };
      var row = document.createElement("div");
      row.className = "favrow" + (name === cur ? " on" : "");
      var code = flagAny(name);
      var flag = code
        ? '<img class="flag" src="https://flagcdn.com/w40/' + code + '.png" alt="">'
        : '<div class="cc"><i class="ti ti-server-2"></i></div>';
      var d = p.delay;
      var ping =
        typeof d === "number" && d !== 0
          ? '<span class="fp" style="color:' +
            delayColor(d) +
            '">' +
            (d > 0 ? d + " мс" : "таймаут") +
            "</span>"
          : "";
      row.innerHTML =
        flag +
        '<div class="fn">' +
        esc(cleanName(name)) +
        "</div>" +
        ping +
        (name === cur
          ? '<i class="ti ti-check" style="color:var(--cy);font-size:16px;flex-shrink:0"></i>'
          : "");
      row.onclick = async function () {
        m.classList.remove("show");
        if (!api.selectProxy) return;
        var rr = await api.selectProxy(curGroup, name);
        if (!rr || !rr.ok) {
          toast("Не удалось выбрать узел");
          return;
        }
        $("hsrv").textContent = cleanName(name);
        setSrvFlag(name);
        toast("Сервер: " + cleanName(name));
      };
      box.appendChild(row);
    });
  }
  if ($("srvCard"))
    $("srvCard").onclick = function () {
      if (!homeEditing) openFavPopup();
    };
  if ($("favClose"))
    $("favClose").onclick = function () {
      $("favModal").classList.remove("show");
    };
  if ($("favAll"))
    $("favAll").onclick = function () {
      $("favModal").classList.remove("show");
      go("srv");
    };
  if ($("favModal"))
    $("favModal").onclick = function (e) {
      if (e.target === this) this.classList.remove("show");
    };
  $("cBack").onclick = function () {
    clearInterval(connTimer);
    go("set");
  };
  $("cClose").onclick = async function () {
    toast("Закрываю соединения…");
    refreshConn();
  };
  if ($("connSearch"))
    $("connSearch").oninput = function () {
      refreshConn();
    };
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      document.body.classList.add("paused");
      clearInterval(connTimer);
    } else {
      document.body.classList.remove("paused");
      var connScr = document.querySelector('.scr[data-screen="connections"].on');
      if (connScr) {
        refreshConn();
        clearInterval(connTimer);
        connTimer = setInterval(refreshConn, 1500);
      }
    }
  });
  function setRuPinnedUi(on) {
    if ($("ruPinnedSw")) $("ruPinnedSw").classList.toggle("on", on);
    var chip = $("ruPinnedChip");
    if (chip) {
      chip.textContent = on ? "Через VPN" : "Без VPN";
      chip.classList.toggle("on", on);
      chip.classList.toggle("off", !on);
    }
    var d = $("ruPinnedDesc");
    if (d)
      d.textContent = on
        ? "Российские сайты (обычные, госуслуги и новости) идут через VPN. Выключите, чтобы открывались напрямую."
        : "Ползунок выключен — все российские сайты открываются без VPN. Включите, чтобы они шли через VPN.";
  }
  async function initSettings() {
    if (api.aiGet) {
      try {
        var ai = await api.aiGet();
        $("aiSw").classList.toggle("on", ai);
        if ($("aiDnsRegionRow")) $("aiDnsRegionRow").style.display = ai ? "" : "none";
        document.querySelectorAll('.qchip[data-q="ai"]').forEach(function (qa) {
          qa.classList.toggle("on", ai);
        });
      } catch (e) {}
    }
    if ($("aiDnsRegion") && !$("aiDnsRegion").__wired) {
      $("aiDnsRegion").__wired = true;
      if (api.aiRegionGet) {
        try {
          $("aiDnsRegion").value = await api.aiRegionGet();
        } catch (e) {}
      }
      $("aiDnsRegion").onchange = async function () {
        var select = this,
          previous = select.dataset.saved || "RU",
          region = select.value;
        select.disabled = true;
        var result = api.aiRegionSet
          ? await api.aiRegionSet(region)
          : { ok: false, error: "Настройка региона недоступна" };
        select.disabled = false;
        if (result && result.ok) {
          select.dataset.saved = region;
          toast("Регион AI-DNS изменён на " + region);
        } else {
          select.value = previous;
          toast("AI-DNS: " + ((result && result.error) || "не удалось сменить регион"));
        }
      };
      $("aiDnsRegion").dataset.saved = $("aiDnsRegion").value || "RU";
    }
    if (api.ruGet && $("ruSw")) {
      try {
        $("ruSw").classList.toggle("on", await api.ruGet());
      } catch (e) {}
    }
    if ($("ruSw") && !$("ruSw").__wired) {
      $("ruSw").__wired = true;
      $("ruSw").onclick = async function () {
        this.classList.toggle("on");
        var on = this.classList.contains("on");
        var r = api.ruSet ? await api.ruSet(on) : { ok: true };
        if (r && r.ok) toast(on ? "RU-оптимизация включена ✓" : "RU-оптимизация выключена");
        else {
          this.classList.toggle("on");
          toast("Ошибка: " + ((r && r.error) || ""));
        }
      };
    }
    if (api.ruSitesGet && $("ruPinnedSw")) {
      try {
        setRuPinnedUi(await api.ruSitesGet());
      } catch (e) {}
    }
    if ($("ruPinnedSw") && !$("ruPinnedSw").__wired) {
      $("ruPinnedSw").__wired = true;
      $("ruPinnedSw").onclick = async function () {
        var on = !this.classList.contains("on");
        setRuPinnedUi(on);
        var r = api.ruSitesSet ? await api.ruSitesSet(on) : { ok: true };
        if (r && r.ok)
          toast(
            r.warning
              ? r.warning
              : on
                ? "Российские сайты идут через VPN"
                : "Российские сайты идут без VPN",
          );
        else {
          setRuPinnedUi(!on);
          toast("Ошибка: " + ((r && r.error) || ""));
        }
      };
    }
    if (api.autostartGet) {
      try {
        $("autoSw").classList.toggle("on", await api.autostartGet());
      } catch (e) {}
    }
    if (api.adminGetAlways && $("adminSw")) {
      try {
        $("adminSw").classList.toggle("on", await api.adminGetAlways());
      } catch (e) {}
    }
    if (api.hotkeyGet) {
      try {
        var h = await api.hotkeyGet();
        curHotkey = h.accelerator || curHotkey;
        $("hotSw").classList.toggle("on", h.enabled);
        setHotLabel();
      } catch (e) {}
    }
    if (api.killGet && $("ksSw")) {
      try {
        $("ksSw").classList.toggle("on", await api.killGet());
      } catch (e) {}
    }
    if ($("ksSw") && !$("ksSw").__wired) {
      $("ksSw").__wired = true;
      $("ksSw").onclick = async function () {
        this.classList.toggle("on");
        var on = this.classList.contains("on");
        var r = api.killSet ? await api.killSet(on) : { ok: true };
        if (r && r.ok)
          toast(r.warning ? r.warning : on ? "Kill Switch включён" : "Kill Switch выключен");
        else {
          this.classList.toggle("on");
          toast("Ошибка: " + ((r && r.error) || ""));
        }
      };
    }
    if ($("autoUpdSw")) {
      $("autoUpdSw").classList.toggle("on", S.autoUpdateSubs !== false);
      if (!$("autoUpdSw").__wired) {
        $("autoUpdSw").__wired = true;
        $("autoUpdSw").onclick = function () {
          this.classList.toggle("on");
          var on = this.classList.contains("on");
          persist({ autoUpdateSubs: on });
          toast(on ? "Авто-обновление подписок включено" : "Авто-обновление выключено");
        };
      }
    }
    if (api.dnsGet && $("dnsMode") && !$("dnsMode").__wired) {
      $("dnsMode").__wired = true;
      try {
        var dc = await api.dnsGet();
        $("dnsMode").value = dc.mode || "auto";
        if (Array.isArray(dc.custom)) $("dnsCustom").value = dc.custom.join(", ");
        $("dnsCustomWrap").style.display = dc.mode === "custom" ? "block" : "none";
        if ($("dnsEff") && Array.isArray(dc.effective))
          $("dnsEff").textContent = "Сейчас: " + dc.effective.join(", ");
      } catch (e) {}
      function saveDns() {
        var mode = $("dnsMode").value;
        var custom = ($("dnsCustom").value || "")
          .split(",")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
        $("dnsCustomWrap").style.display = mode === "custom" ? "block" : "none";
        if (api.dnsSet)
          api.dnsSet({ mode: mode, custom: custom }).then(function (r) {
            if (r && r.ok) {
              if ($("dnsEff") && r.effective)
                $("dnsEff").textContent = "Сейчас: " + r.effective.join(", ");
              toast("DNS обновлён ✓");
            } else toast("DNS: " + ((r && r.error) || "ошибка"));
          });
      }
      $("dnsMode").onchange = saveDns;
      var dcTimer = null;
      $("dnsCustom").oninput = function () {
        clearTimeout(dcTimer);
        dcTimer = setTimeout(saveDns, 800);
      };
    }
    if ($("proxyAddr") && !$("proxyAddr").__wired) {
      $("proxyAddr").__wired = true;
      $("proxyAddr").onclick = function () {
        var b = this;
        if (b.__orig === undefined) b.__orig = b.textContent;
        try {
          navigator.clipboard.writeText(b.__orig);
        } catch (_) {}
        clearTimeout(b.__t);
        b.textContent = "Скопировано ✓";
        b.__t = setTimeout(function () {
          b.textContent = b.__orig;
          b.__orig = undefined;
        }, 1200);
      };
    }
  }
  var LAYOUT_VERSION = 3;
  var HOME_WIDGETS = [
    { id: "power", title: "Кнопка подключения", removable: false, w: "full" },
    { id: "server", title: "Сервер", removable: true, w: "half" },
    { id: "mode", title: "Режим", removable: true, w: "half" },
    { id: "stats", title: "Скорость и сессия", removable: true, w: "full" },
    { id: "ip", title: "IP-адрес", removable: true, w: "full" },
    { id: "toggles", title: "Быстрые тумблеры", removable: true, w: "full" },
    { id: "subbar", title: "Подписка (полоса)", removable: true, w: "full" },
    { id: "support", title: "Поддержка", removable: true, w: "full" },
    { id: "note", title: "Заметка", removable: true, w: "full" },
    { id: "ping", title: "Пинг сервера", removable: true, w: "half" },
    { id: "dl", title: "Скорость ↓", removable: true, w: "half" },
    { id: "ul", title: "Скорость ↑", removable: true, w: "half" },
    { id: "uptime", title: "Время сессии", removable: true, w: "half" },
    { id: "today", title: "Трафик за сегодня", removable: true, w: "half" },
    { id: "sparkline", title: "График скорости", removable: true, w: "full" },
    { id: "toggle_ai", title: "Тумблер AI-DNS", removable: true, w: "half" },
    { id: "toggle_tun", title: "Тумблер TUN", removable: true, w: "half" },
    { id: "fidget", title: "Спиннер", removable: true, w: "half" },
    { id: "globe", title: "Снежный шар", removable: true, w: "half" },
    { id: "roulette", title: "Колесо серверов", removable: true, w: "half" },
    { id: "snowman", title: "Снеговик", removable: true, w: "half" },
  ];
  function DEFAULT_LAYOUT() {
    var on = [
      { id: "power", on: true, w: "full" },
      { id: "server", on: true, w: "half" },
      { id: "mode", on: true, w: "half" },
      { id: "stats", on: true, w: "full" },
      { id: "ip", on: true, w: "full" },
      { id: "toggles", on: true, w: "full" },
    ];
    var onIds = on.map(function (e) {
      return e.id;
    });
    HOME_WIDGETS.forEach(function (w) {
      if (onIds.indexOf(w.id) < 0) on.push({ id: w.id, on: false, w: w.w });
    });
    return on;
  }
  function widgetDef(id) {
    for (var i = 0; i < HOME_WIDGETS.length; i++)
      if (HOME_WIDGETS[i].id === id) return HOME_WIDGETS[i];
    return null;
  }
  function validLayout(raw) {
    try {
      if (!Array.isArray(raw) || !raw.length) throw 0;
      var seen = {},
        out = [];
      raw.forEach(function (e) {
        var def = e && widgetDef(e.id);
        if (def && !seen[e.id]) {
          seen[e.id] = 1;
          out.push({
            id: e.id,
            on: e.on !== false,
            w: e.w === "half" || e.w === "third" ? e.w : "full",
          });
        }
      });
      if (!seen.power) out.unshift({ id: "power", on: true, w: "full" });
      HOME_WIDGETS.forEach(function (w) {
        if (!seen[w.id]) out.push({ id: w.id, on: false, w: w.w });
      });
      out.forEach(function (e) {
        if (e.id === "power") {
          e.on = true;
          e.w = "full";
        }
      });
      if (!out.length) throw 0;
      return out;
    } catch (_) {
      return DEFAULT_LAYOUT();
    }
  }
  var homeLayout = null,
    homeEditing = false,
    dragW = null;
  function renderLayout() {
    var hero = $("hero");
    if (!hero || !homeLayout) return;
    homeLayout.forEach(function (e, idx) {
      var el = hero.querySelector('.widget[data-w="' + e.id + '"]');
      if (!el) return;
      el.style.order = idx;
      el.style.display = e.on ? "" : "none";
      el.classList.toggle("half", e.w === "half");
      el.classList.toggle("third", e.w === "third");
    });
    packMasonry();
  }
  var masonryQueued = false;
  function packMasonryNow() {
    var hero = $("hero");
    if (!hero) return;
    var cs = getComputedStyle(hero);
    var rowPx = parseFloat(cs.gridAutoRows) || 1;
    var gapPx = parseFloat(cs.rowGap) || parseFloat(cs.gap) || 12;
    hero.querySelectorAll(".widget").forEach(function (el) {
      if (el.style.display === "none") return;
      el.style.gridRowEnd = "";
      var h = el.getBoundingClientRect().height;
      var n = Math.max(1, Math.ceil((h + gapPx) / (rowPx + gapPx)));
      el.style.gridRowEnd = "span " + n;
    });
  }
  function packMasonry() {
    if (masonryQueued) return;
    masonryQueued = true;
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      masonryQueued = false;
      packMasonryNow();
    };
    requestAnimationFrame(function () {
      requestAnimationFrame(run);
    });
    setTimeout(run, 120);
  }
  var masonryResizeT = null;
  window.addEventListener("resize", function () {
    clearTimeout(masonryResizeT);
    masonryResizeT = setTimeout(packMasonry, 150);
  });
  function loadLayout() {
    if (S.layoutVersion !== LAYOUT_VERSION || !Array.isArray(S.layout)) {
      homeLayout = DEFAULT_LAYOUT();
      S.layout = homeLayout;
      S.layoutVersion = LAYOUT_VERSION;
      if (api.saveSettings) api.saveSettings({ layout: homeLayout, layoutVersion: LAYOUT_VERSION });
    } else {
      homeLayout = validLayout(S.layout);
    }
    renderLayout();
  }
  function widgetEl(id) {
    return $("hero").querySelector('.widget[data-w="' + id + '"]');
  }
  function ensureHandles() {
    homeLayout.forEach(function (e) {
      var el = widgetEl(e.id);
      if (!el) return;
      if (!el.querySelector(".whandle")) {
        var h = document.createElement("div");
        h.className = "whandle";
        h.innerHTML = '<i class="ti ti-grip-vertical"></i>';
        el.appendChild(h);
      }
      var def = widgetDef(e.id);
      if (e.id !== "power" && !el.querySelector(".wwidth")) {
        var wb = document.createElement("div");
        wb.className = "wwidth";
        wb.title = "Ширина: полная / половина / треть";
        wb.innerHTML = '<i class="ti ti-arrows-horizontal"></i>';
        wb.onclick = function (ev) {
          ev.stopPropagation();
          toggleWidgetWidth(e.id);
        };
        el.appendChild(wb);
      }
      if (def && def.removable && !el.querySelector(".wremove")) {
        var x = document.createElement("div");
        x.className = "wremove";
        x.innerHTML = '<i class="ti ti-x"></i>';
        x.onclick = function (ev) {
          ev.stopPropagation();
          setWidgetOn(e.id, false);
        };
        el.appendChild(x);
      }
      el.draggable = homeEditing && e.id !== "power";
      wireWidgetDrag(el);
    });
  }
  function clearHandles() {
    $("hero")
      .querySelectorAll(".whandle,.wremove,.wwidth")
      .forEach(function (n) {
        n.remove();
      });
    $("hero")
      .querySelectorAll(".widget")
      .forEach(function (n) {
        n.draggable = false;
      });
  }
  function toggleWidgetWidth(id) {
    var e = homeLayout.filter(function (x) {
      return x.id === id;
    })[0];
    if (!e) return;
    e.w = e.w === "full" ? "half" : e.w === "half" ? "third" : "full";
    renderLayout();
  }
  function wireWidgetDrag(el) {
    if (el.__wdrag) return;
    el.__wdrag = true;
    el.addEventListener("dragstart", function (e) {
      if (!homeEditing) {
        e.preventDefault();
        return;
      }
      dragW = el.dataset.w;
      el.classList.add("dragging");
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragW);
      } catch (_) {}
    });
    el.addEventListener("dragend", function () {
      el.classList.remove("dragging");
      $("hero")
        .querySelectorAll(".dropbefore")
        .forEach(function (n) {
          n.classList.remove("dropbefore");
        });
      dragW = null;
    });
    el.addEventListener("dragover", function (e) {
      if (!homeEditing || !dragW || dragW === el.dataset.w) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!el.classList.contains("dropbefore")) {
        $("hero")
          .querySelectorAll(".dropbefore")
          .forEach(function (n) {
            n.classList.remove("dropbefore");
          });
        el.classList.add("dropbefore");
      }
    });
    el.addEventListener("dragleave", function () {
      el.classList.remove("dropbefore");
    });
    el.addEventListener("drop", function (e) {
      if (!homeEditing) return;
      e.preventDefault();
      el.classList.remove("dropbefore");
      var target = el.dataset.w;
      if (!dragW || dragW === target) return;
      var from = homeLayout
        .map(function (x) {
          return x.id;
        })
        .indexOf(dragW);
      var to = homeLayout
        .map(function (x) {
          return x.id;
        })
        .indexOf(target);
      if (from < 0 || to < 0) return;
      var moved = homeLayout.splice(from, 1)[0];
      to = homeLayout
        .map(function (x) {
          return x.id;
        })
        .indexOf(target);
      homeLayout.splice(to, 0, moved);
      var pi = homeLayout
        .map(function (x) {
          return x.id;
        })
        .indexOf("power");
      if (pi > 0) {
        var p = homeLayout.splice(pi, 1)[0];
        homeLayout.unshift(p);
      }
      renderLayout();
      toast("Блок «" + ((widgetDef(dragW) || {}).title || "") + "» перемещён");
    });
  }
  function setWidgetOn(id, on) {
    var e = homeLayout.filter(function (x) {
      return x.id === id;
    })[0];
    var def = widgetDef(id);
    if (!e) {
      e = { id: id, on: on, w: def ? def.w : "full" };
      homeLayout.push(e);
    } else e.on = on;
    if (id === "power") e.on = true;
    renderLayout();
    if (homeEditing) {
      ensureHandles();
      buildAddPanel();
    }
  }
  function widgetPreview(id) {
    var W = {
      server: '<div class="ppv"><span class="ppl">СЕРВЕР</span><b>🇱🇹 Netherlands</b></div>',
      mode: '<div class="ppv"><span class="ppl">РЕЖИМ</span><b>По приложениям</b></div>',
      stats: '<div class="ppv" style="text-align:center"><b>0.0 ↓ · 0.0 ↑ · 00:00</b></div>',
      ip: '<div class="ppv"><span class="ppl">IP-АДРЕС</span><b>88.119.176.156</b></div>',
      toggles: '<div class="ppv" style="text-align:center"><b>TUN · Прокси · AI-DNS</b></div>',
      subbar:
        '<div class="ppv"><span class="ppl">ПОДПИСКА</span><div class="ppbar"><i></i></div></div>',
      support: '<div class="ppv"><span class="ppl">ПОДДЕРЖКА</span><b>t.me/…</b></div>',
      note: '<div class="ppv"><span class="ppl">ЗАМЕТКА</span><b>свой текст…</b></div>',
      ping: '<div class="ppv"><span class="ppl">ПИНГ</span><b>42 мс</b></div>',
      dl: '<div class="ppv"><span class="ppl">СКАЧИВАНИЕ ↓</span><b>68.4 Мбит/с</b></div>',
      ul: '<div class="ppv"><span class="ppl">ОТДАЧА ↑</span><b>12.0 Мбит/с</b></div>',
      uptime: '<div class="ppv"><span class="ppl">СЕССИЯ</span><b>01:23</b></div>',
      today: '<div class="ppv"><span class="ppl">СЕГОДНЯ</span><b>1.2 ГБ</b></div>',
      sparkline:
        '<div class="ppv"><span class="ppl">СКОРОСТЬ</span><svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points="0,20 20,10 40,16 60,4 80,14 100,8" fill="none" stroke="var(--cy)" stroke-width="2"/></svg></div>',
      toggle_ai: '<div class="ppv" style="text-align:center"><b>✦ AI-DNS</b></div>',
      toggle_tun: '<div class="ppv" style="text-align:center"><b>🛡 TUN</b></div>',
      fidget:
        '<div class="ppv" style="text-align:center"><svg viewBox="0 0 100 100" width="34" height="34"><path d="M50 20 L28 62 L72 62 Z" fill="none" stroke="var(--cy)" stroke-width="17" stroke-linejoin="round" opacity=".32"/><circle cx="50" cy="20" r="13" fill="var(--cy)"/><circle cx="28" cy="62" r="13" fill="var(--cy)"/><circle cx="72" cy="62" r="13" fill="var(--cy)"/></svg></div>',
      globe:
        '<div class="ppv" style="text-align:center"><svg viewBox="0 0 100 100" width="34" height="34"><circle cx="50" cy="44" r="30" fill="rgba(120,200,230,.18)" stroke="var(--cy)" stroke-width="3"/><rect x="30" y="74" width="40" height="10" rx="4" fill="var(--cy)" opacity=".7"/><circle cx="40" cy="34" r="3" fill="#fff"/><circle cx="58" cy="46" r="2.5" fill="#fff"/><circle cx="47" cy="56" r="2" fill="#fff"/><circle cx="62" cy="30" r="2" fill="#fff"/></svg></div>',
      roulette:
        '<div class="ppv" style="text-align:center"><svg viewBox="0 0 100 100" width="34" height="34"><circle cx="50" cy="52" r="30" fill="none" stroke="var(--cy)" stroke-width="3"/><path d="M50 52 L50 22 A30 30 0 0 1 76 37 Z" fill="var(--cy)" opacity=".55"/><path d="M50 52 L76 67 A30 30 0 0 1 50 82 Z" fill="var(--cy)" opacity=".25"/><circle cx="50" cy="52" r="5" fill="var(--cy)"/><path d="M50 10 L44 22 L56 22 Z" fill="var(--cy)"/></svg></div>',
      snowman:
        '<div class="ppv" style="text-align:center"><svg viewBox="0 0 100 100" width="34" height="34"><circle cx="50" cy="68" r="22" fill="#eef6fa"/><circle cx="50" cy="38" r="16" fill="#f7fbfd"/><rect x="34" y="20" width="32" height="7" rx="2" fill="var(--cy)"/><rect x="40" y="6" width="20" height="16" rx="3" fill="var(--cy)"/><circle cx="44" cy="36" r="2.6" fill="#26323c"/><circle cx="56" cy="36" r="2.6" fill="#26323c"/><path d="M50 41 L60 44 L50 46 Z" fill="#ff9e4d"/></svg></div>',
    };
    return W[id] || '<div class="ppv"><b>' + (widgetDef(id) || {}).title + "</b></div>";
  }
  function buildAddPanel() {
    var box = $("homeAddPanel");
    if (!box) return;
    var off = homeLayout.filter(function (e) {
      return !e.on;
    });
    box.innerHTML = "";
    if (!off.length) {
      box.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;color:var(--dim);font-size:13px;padding:14px">Все блоки уже на экране</div>';
      return;
    }
    off.forEach(function (e) {
      var def = widgetDef(e.id);
      if (!def) return;
      var c = document.createElement("div");
      c.className = "addcard";
      c.innerHTML =
        '<div class="addprev">' +
        widgetPreview(e.id) +
        '</div><div class="addname"><span>' +
        def.title +
        '</span><i class="ti ti-plus"></i></div>';
      c.onclick = function () {
        setWidgetOn(e.id, true);
      };
      box.appendChild(c);
    });
  }
  function openAddModal() {
    if ($("addModal")) {
      $("addModal").style.display = "flex";
      buildAddPanel();
    }
  }
  function closeAddModal() {
    if ($("addModal")) $("addModal").style.display = "none";
  }
  function enterHomeEdit() {
    homeEditing = true;
    $("hero").classList.add("editing");
    $("homeEdit").style.display = "none";
    $("homeEditBar").style.display = "flex";
    ensureHandles();
    packMasonry();
  }
  function exitHomeEdit(save) {
    homeEditing = false;
    $("hero").classList.remove("editing");
    closeAddModal();
    clearHandles();
    $("homeEdit").style.display = "";
    $("homeEditBar").style.display = "none";
    if (save) {
      persist({ layout: homeLayout, layoutVersion: LAYOUT_VERSION });
      toast("Раскладка сохранена ✓");
      packMasonry();
    } else {
      loadLayout();
    }
  }
  function wireHomeEdit() {
    if ($("homeEdit")) $("homeEdit").onclick = enterHomeEdit;
    if ($("homeDone"))
      $("homeDone").onclick = function () {
        exitHomeEdit(true);
      };
    if ($("homeReset"))
      $("homeReset").onclick = function () {
        homeLayout = DEFAULT_LAYOUT();
        renderLayout();
        ensureHandles();
        toast("Сброшено к стандартной раскладке");
      };
    if ($("homeAdd")) $("homeAdd").onclick = openAddModal;
    if ($("addClose")) $("addClose").onclick = closeAddModal;
    if ($("addModal"))
      $("addModal").onclick = function (e) {
        if (e.target === $("addModal")) closeAddModal();
      };
    if ($("noteText")) {
      $("noteText").value = S.note || "";
      $("noteText").onchange = function () {
        persist({ note: this.value });
      };
    }
  }
  (function initFidget() {
    var rotor = $("fidgetRotor"),
      svg = $("fidgetSvg");
    if (!rotor || !svg) return;
    var VEL_MAX = 6e6;
    var angle = 0,
      vel = 0,
      raf = null,
      lastT = 0,
      lastTickSeg = 0;
    var actx = null;
    function audio() {
      if (S.fidgetSnd === false) return null;
      if (!actx) {
        try {
          actx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (_) {
          return null;
        }
      }
      if (actx.state === "suspended") {
        try {
          actx.resume();
        } catch (_) {}
      }
      return actx;
    }
    function tick(vol) {
      var ctx = audio();
      if (!ctx) return;
      try {
        var o = ctx.createOscillator(),
          g = ctx.createGain();
        o.type = "triangle";
        o.frequency.value = 1900 + Math.random() * 400;
        g.gain.setValueAtTime(Math.min(0.16, vol * 0.16), ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + 0.03);
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.035);
      } catch (_) {}
    }
    function clickSnd(speed) {
      var ctx = audio();
      if (!ctx) return;
      try {
        var o = ctx.createOscillator(),
          g = ctx.createGain();
        var base = 300 + Math.min(1400, Math.abs(speed) / 6);
        o.type = "sawtooth";
        o.frequency.setValueAtTime(base, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(base * 2.2, ctx.currentTime + 0.09);
        g.gain.setValueAtTime(0.13, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + 0.1);
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.11);
      } catch (_) {}
    }
    var lastGlow = -1;
    function draw() {
      rotor.style.transform = "rotate(" + (angle % 360) + "deg)";
      var g = Math.min(10, Math.round(Math.abs(vel) / 500));
      if (g !== lastGlow) {
        lastGlow = g;
        rotor.style.filter = g
          ? "drop-shadow(0 0 " + (2 + g) + "px color-mix(in srgb, var(--cy) 55%, transparent))"
          : "";
      }
    }
    var best = 0,
      bestDirty = false;
    function bestUi() {
      var el = $("fidgetBest");
      if (el) el.textContent = best > 0 ? "· рекорд " + best : "";
    }
    function rpmUi() {
      var el = $("fidgetRpm");
      var rpm = Math.round(Math.abs(vel) / 6);
      if (el) el.textContent = String(rpm);
      if (!best && S.fidgetBest > 0) best = S.fidgetBest;
      if (rpm > best) {
        best = rpm;
        bestDirty = true;
        bestUi();
      }
      if (vel === 0 && bestDirty) {
        bestDirty = false;
        persist({ fidgetBest: best });
      }
    }
    function loop(t) {
      raf = null;
      if (document.hidden) {
        lastT = 0;
        return;
      }
      if (!lastT) lastT = t;
      var dt = Math.min(0.05, (t - lastT) / 1e3);
      lastT = t;
      angle += vel * dt;
      vel *= Math.exp(-dt / 3.2);
      if (Math.abs(vel) < 8) {
        vel = 0;
      }
      var seg = Math.floor(angle / 120);
      if (seg !== lastTickSeg) {
        lastTickSeg = seg;
        if (Math.abs(vel) > 60) tick(Math.min(1, Math.abs(vel) / 2600));
      }
      draw();
      rpmUi();
      if (vel !== 0) raf = requestAnimationFrame(loop);
      else lastT = 0;
    }
    function kick() {
      if (!raf && vel !== 0) {
        lastT = 0;
        raf = requestAnimationFrame(loop);
      }
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) kick();
    });
    function ptrAngle(e) {
      var r = svg.getBoundingClientRect();
      return (
        (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) /
        Math.PI
      );
    }
    var dragging = false,
      lastPtr = 0,
      lastMoveT = 0,
      dragVel = 0,
      moved = 0,
      lastDir = 1;
    var prevVel = 0,
      downT = 0;
    svg.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (_) {}
      dragging = true;
      moved = 0;
      dragVel = 0;
      prevVel = vel;
      downT = performance.now();
      lastPtr = ptrAngle(e);
      lastMoveT = performance.now();
      vel = 0;
      svg.style.cursor = "grabbing";
      audio();
    });
    svg.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var now = performance.now(),
        a = ptrAngle(e);
      var d = a - lastPtr;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      var dt = Math.max(0.008, (now - lastMoveT) / 1e3);
      angle += d;
      moved += Math.abs(d);
      dragVel = dragVel * 0.7 + (d / dt) * 0.3;
      lastPtr = a;
      lastMoveT = now;
      draw();
    });
    function release() {
      if (!dragging) return;
      dragging = false;
      svg.style.cursor = "grab";
      if (moved < 6) {
        var boost = function (v) {
          return Math.max(300, Math.abs(v) * 0.25);
        };
        if (prevVel !== 0 && performance.now() - downT < 300) {
          var dir = prevVel > 0 ? 1 : -1;
          vel = prevVel + boost(prevVel) * dir;
          lastDir = vel > 0 ? 1 : -1;
        } else {
          vel += (Math.abs(vel) ? boost(vel) : 1500) * lastDir;
        }
        if (Math.abs(vel) > VEL_MAX) vel = VEL_MAX * (vel > 0 ? 1 : -1);
        clickSnd(vel);
      } else {
        vel = performance.now() - lastMoveT > 120 ? 0 : Math.max(-6e3, Math.min(6e3, dragVel));
        if (vel) lastDir = vel > 0 ? 1 : -1;
      }
      kick();
    }
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);
    var snd = $("fidgetSnd");
    function sndUi() {
      if (snd) snd.className = "ti " + (S.fidgetSnd === false ? "ti-volume-off" : "ti-volume");
    }
    if (snd)
      snd.onclick = function (e) {
        e.stopPropagation();
        persist({ fidgetSnd: S.fidgetSnd === false ? true : false });
        sndUi();
        toast(S.fidgetSnd === false ? "Звук спиннера выключен" : "Звук спиннера включён");
      };
    setTimeout(function () {
      sndUi();
      if (S.fidgetBest > 0) {
        best = S.fidgetBest;
        bestUi();
      }
    }, 1200);
  })();
  var toyActx = null,
    toyNoise = null;
  function toyAudio(on) {
    if (on === false) return null;
    if (!toyActx) {
      try {
        toyActx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        return null;
      }
    }
    if (toyActx.state === "suspended") {
      try {
        toyActx.resume();
      } catch (_) {}
    }
    return toyActx;
  }
  function toyNoiseBuf(ctx) {
    if (toyNoise) return toyNoise;
    var b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate),
      d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    toyNoise = b;
    return b;
  }
  function toyHiss(on, vol, freq, dur) {
    var ctx = toyAudio(on);
    if (!ctx) return;
    try {
      var s = ctx.createBufferSource();
      s.buffer = toyNoiseBuf(ctx);
      s.loop = true;
      s.playbackRate.value = 0.8 + Math.random() * 0.5;
      var f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = 0.8;
      var g = ctx.createGain();
      g.gain.setValueAtTime(1e-4, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(2e-4, vol), ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + dur);
      s.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      s.start();
      s.stop(ctx.currentTime + dur + 0.02);
    } catch (_) {}
  }
  function toyBlip(on, type, f0, f1, vol, dur) {
    var ctx = toyAudio(on);
    if (!ctx) return;
    try {
      var o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f0, ctx.currentTime);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur + 0.02);
    } catch (_) {}
  }
  function toyCanvas(cv, size) {
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  function toyVisible(id) {
    if (document.hidden) return false;
    var home = document.querySelector('.scr[data-screen="home"]');
    if (!home || !home.classList.contains("on")) return false;
    var el = $("hero") && $("hero").querySelector('.widget[data-w="' + id + '"]');
    return !!el && el.style.display !== "none";
  }
  var toyKicks = [];
  function toyLoop(id, step) {
    var raf = null,
      last = 0;
    function frame(t) {
      raf = null;
      if (!toyVisible(id)) {
        last = 0;
        return;
      }
      if (!last) last = t;
      var dt = Math.min(0.05, (t - last) / 1e3);
      last = t;
      var alive = true;
      try {
        alive = step(dt) !== false;
      } catch (_) {}
      if (alive) raf = requestAnimationFrame(frame);
      else last = 0;
    }
    function kick() {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }
    toyKicks.push(function () {
      if (toyVisible(id)) kick();
    });
    return kick;
  }
  setInterval(function () {
    for (var i = 0; i < toyKicks.length; i++) toyKicks[i]();
  }, 900);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) for (var i = 0; i < toyKicks.length; i++) toyKicks[i]();
  });
  (function initGlobe() {
    var cv = $("globeCv");
    if (!cv) return;
    var SZ = 230,
      ctx = toyCanvas(cv, SZ);
    var CX = 115,
      CY = 92,
      R = 74;
    var fl = [],
      N = 95;
    function mkFlake(anywhere) {
      var a = Math.random() * Math.PI * 2,
        d = Math.sqrt(Math.random()) * (R - 10);
      return {
        x: CX + Math.cos(a) * d,
        y: anywhere ? CY + Math.sin(a) * d : CY - R + 10 + Math.random() * 20,
        vx: 0,
        vy: 8 + Math.random() * 18,
        r: 0.9 + Math.random() * 1.9,
        sw: Math.random() * 6.28,
        rest: false,
      };
    }
    for (var i = 0; i < N; i++) fl.push(mkFlake(true));
    var shakes = 0,
      shakesDirty = false,
      wob = 0,
      wobV = 0,
      gust = 0,
      lastHiss = 0;
    function settledCount() {
      var n = 0;
      for (var i = 0; i < fl.length; i++) if (fl[i].rest) n++;
      return n;
    }
    function clampFlakes() {
      for (var i = 0; i < fl.length; i++) {
        var f = fl[i];
        var dx = f.x - CX,
          dy = f.y - CY,
          d = Math.sqrt(dx * dx + dy * dy),
          lim = R - f.r - 2;
        if (!(d > lim)) continue;
        var nx = d > 0 ? dx / d : 0,
          ny = d > 0 ? dy / d : 1;
        f.x = CX + nx * lim;
        f.y = CY + ny * lim;
      }
    }
    function step(dt) {
      gust *= Math.exp(-dt * 1.6);
      gust = Math.max(-90, Math.min(90, gust));
      wobV += -wob * 120 * dt;
      wobV *= Math.exp(-dt * 3.2);
      wob += wobV * dt;
      var WOB_MAX = 14;
      if (wob > WOB_MAX) {
        wob = WOB_MAX;
        if (wobV > 0) wobV = 0;
      } else if (wob < -WOB_MAX) {
        wob = -WOB_MAX;
        if (wobV < 0) wobV = 0;
      }
      var moving = false;
      var VMAX = 900;
      for (var i = 0; i < fl.length; i++) {
        var f = fl[i];
        if (f.rest) continue;
        moving = true;
        f.sw += dt * 2.2;
        f.vy += 24 * dt;
        f.vx += (Math.sin(f.sw) * 5 + gust) * dt * 9;
        f.vx *= Math.exp(-dt * 1);
        f.vy *= Math.exp(-dt * 0.85);
        if (f.vx > VMAX) f.vx = VMAX;
        else if (f.vx < -VMAX) f.vx = -VMAX;
        if (f.vy > VMAX) f.vy = VMAX;
        else if (f.vy < -VMAX) f.vy = -VMAX;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        var dx = f.x - CX,
          dy = f.y - CY,
          d = Math.sqrt(dx * dx + dy * dy),
          lim = R - f.r - 2;
        if (d > lim) {
          var nx = dx / d,
            ny = dy / d;
          f.x = CX + nx * lim;
          f.y = CY + ny * lim;
          var vn = f.vx * nx + f.vy * ny;
          f.vx -= nx * vn * 1.3;
          f.vy -= ny * vn * 1.3;
          f.vx *= 0.5;
          f.vy *= 0.5;
          if (ny > 0.3 && Math.abs(f.vx) + Math.abs(f.vy) < 16) {
            f.rest = true;
            f.vx = f.vy = 0;
          }
        }
      }
      clampFlakes();
      draw();
      return moving || Math.abs(gust) > 0.02 || Math.abs(wob) > 0.03 || Math.abs(wobV) > 0.03;
    }
    function wake(ix, iy, power) {
      ix = Math.max(-45, Math.min(45, ix));
      iy = Math.max(-45, Math.min(45, iy));
      for (var i = 0; i < fl.length; i++) {
        var f = fl[i];
        f.rest = false;
        f.vx += ix * (0.5 + Math.random());
        f.vy += iy * (0.5 + Math.random()) - Math.random() * power * 0.5;
      }
      gust += ix * 0.35;
      wobV += ix * 0.5;
      wobV = Math.max(-260, Math.min(260, wobV));
      var now = performance.now();
      if (now - lastHiss > 90) {
        lastHiss = now;
        toyHiss(
          S.globeSnd,
          Math.min(0.05, 0.006 + power * 0.0016),
          1500 + Math.random() * 900,
          0.16,
        );
      }
    }
    function drawScene() {
      ctx.fillStyle = "rgba(255,255,255,.10)";
      [
        [CX - 44, 6],
        [CX + 46, 5],
      ].forEach(function (t) {
        var bx = t[0],
          s = t[1];
        ctx.beginPath();
        ctx.moveTo(bx, CY + R - 26 - s * 4);
        ctx.lineTo(bx - s * 2.2, CY + R - 14);
        ctx.lineTo(bx + s * 2.2, CY + R - 14);
        ctx.closePath();
        ctx.fill();
      });
      var gy = CY + R - 18;
      ctx.fillStyle = "#eaf4fa";
      ctx.beginPath();
      ctx.arc(CX, gy - 7, 11, 0, 6.284);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CX, gy - 22, 7.5, 0, 6.284);
      ctx.fill();
      ctx.fillStyle = "rgba(30,44,54,.9)";
      ctx.beginPath();
      ctx.arc(CX - 2.8, gy - 23.5, 1.2, 0, 6.284);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CX + 2.8, gy - 23.5, 1.2, 0, 6.284);
      ctx.fill();
      ctx.fillStyle = "#ff9e4d";
      ctx.beginPath();
      ctx.moveTo(CX, gy - 21);
      ctx.lineTo(CX + 7, gy - 19.6);
      ctx.lineTo(CX, gy - 18.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(70,200,220,.85)";
      ctx.fillRect(CX - 8, gy - 31.5, 16, 3);
      ctx.fillRect(CX - 5.5, gy - 38, 11, 7);
    }
    function drawMound() {
      var k = settledCount() / fl.length;
      var h = 10 + k * 16;
      ctx.fillStyle = "#f2f9fc";
      ctx.beginPath();
      ctx.moveTo(CX - R, CY + R);
      ctx.quadraticCurveTo(CX, CY + R - h, CX + R, CY + R);
      ctx.lineTo(CX + R, CY + R + 6);
      ctx.lineTo(CX - R, CY + R + 6);
      ctx.closePath();
      ctx.fill();
    }
    function drawFlakes() {
      for (var i = 0; i < fl.length; i++) {
        var f = fl[i];
        ctx.globalAlpha = f.rest ? 0.95 : 0.55 + f.r * 0.18;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, 6.284);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawGlass() {
      var g = ctx.createRadialGradient(
        CX - R * 0.42,
        CY - R * 0.5,
        2,
        CX - R * 0.3,
        CY - R * 0.35,
        R * 1.15,
      );
      g.addColorStop(0, "rgba(255,255,255,.30)");
      g.addColorStop(0.35, "rgba(255,255,255,.05)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(CX, CY, R, 0, 6.284);
      ctx.fill();
      ctx.strokeStyle = "rgba(180,235,250,.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, CY, R - 1, 0, 6.284);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.65)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(CX, CY, R - 5, 3.6, 4.6);
      ctx.stroke();
    }
    function drawBase() {
      var top = CY + R - 12,
        h = 34;
      var g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, "#43606f");
      g.addColorStop(0.5, "#2c414d");
      g.addColorStop(1, "#1b2a33");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(CX - 48, top);
      ctx.lineTo(CX + 48, top);
      ctx.quadraticCurveTo(CX + 62, top + h, CX + 52, top + h);
      ctx.lineTo(CX - 52, top + h);
      ctx.quadraticCurveTo(CX - 62, top + h, CX - 48, top);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(12,20,26,.55)";
      ctx.beginPath();
      var px = CX - 40,
        py = top + 9,
        pw = 80,
        ph = 17,
        rr = 5;
      ctx.moveTo(px + rr, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, rr);
      ctx.arcTo(px + pw, py + ph, px, py + ph, rr);
      ctx.arcTo(px, py + ph, px, py, rr);
      ctx.arcTo(px, py, px + pw, py, rr);
      ctx.closePath();
      ctx.fill();
      var txt = (S.globeText || "").trim() || "Ннчик";
      ctx.fillStyle = "rgba(190,240,250,.92)";
      ctx.font = "600 11px system-ui,Segoe UI,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var w = ctx.measureText(txt).width,
        max = pw - 10;
      if (w > max) {
        ctx.save();
        ctx.translate(CX, py + ph / 2);
        ctx.scale(max / w, 1);
        ctx.fillText(txt, 0, 0);
        ctx.restore();
      } else ctx.fillText(txt, CX, py + ph / 2);
    }
    function draw() {
      ctx.clearRect(0, 0, SZ, SZ);
      ctx.save();
      ctx.translate(wob, 0);
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, R, 0, 6.284);
      ctx.clip();
      var g = ctx.createLinearGradient(0, CY - R, 0, CY + R);
      g.addColorStop(0, "#0d2131");
      g.addColorStop(1, "#1d4257");
      ctx.fillStyle = g;
      ctx.fillRect(CX - R, CY - R, R * 2, R * 2);
      drawScene();
      drawMound();
      drawFlakes();
      ctx.restore();
      drawGlass();
      ctx.restore();
      drawBase();
    }
    var kick = toyLoop("globe", step);
    var down = false,
      lx = 0,
      ly = 0,
      moved = 0,
      shakeAcc = 0;
    cv.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      try {
        cv.setPointerCapture(e.pointerId);
      } catch (_) {}
      down = true;
      moved = 0;
      shakeAcc = 0;
      lx = e.clientX;
      ly = e.clientY;
      cv.style.cursor = "grabbing";
      toyAudio(S.globeSnd);
      kick();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!down) return;
      var dx = e.clientX - lx,
        dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      var m = Math.sqrt(dx * dx + dy * dy);
      if (m < 0.6) return;
      moved += m;
      shakeAcc += m;
      wake(dx * 1.5, dy * 1.5, Math.min(14, m));
      if (shakeAcc > 140) {
        shakeAcc = 0;
        shakes++;
        shakesDirty = true;
        ui();
      }
      kick();
    });
    function up() {
      if (!down) return;
      down = false;
      cv.style.cursor = "grab";
      if (moved < 5) {
        for (var i = 0; i < fl.length; i++) {
          var f = fl[i],
            a = Math.random() * 6.284;
          f.rest = false;
          f.vx += Math.cos(a) * 70;
          f.vy += Math.sin(a) * 70 - 60;
        }
        wobV += 1.2;
        toyHiss(S.globeSnd, 0.05, 1300, 0.4);
        shakes++;
        shakesDirty = true;
        ui();
      }
      if (shakesDirty) {
        shakesDirty = false;
        persist({ globeShakes: shakes });
      }
      kick();
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    function ui() {
      var el = $("globeShakes");
      if (el) el.textContent = String(shakes);
    }
    var inp = $("globeText");
    if (inp) {
      inp.oninput = function () {
        S.globeText = this.value;
        draw();
      };
      inp.onblur = function () {
        persist({ globeText: this.value });
      };
      inp.onkeydown = function (e) {
        if (e.key === "Enter") this.blur();
      };
    }
    var snd = $("globeSnd");
    function sndUi() {
      if (snd) snd.className = "ti " + (S.globeSnd === false ? "ti-volume-off" : "ti-volume");
    }
    if (snd)
      snd.onclick = function (e) {
        e.stopPropagation();
        persist({ globeSnd: S.globeSnd === false ? true : false });
        sndUi();
        toast(S.globeSnd === false ? "Звук шара выключен" : "Звук шара включён");
      };
    setTimeout(function () {
      sndUi();
      if (S.globeShakes > 0) {
        shakes = S.globeShakes;
        ui();
      }
      if (inp && S.globeText) inp.value = S.globeText;
      draw();
    }, 1200);
    draw();
  })();
  var refreshRoulette = null;
  (function initRoulette() {
    var cv = $("rouCv");
    if (!cv) return;
    var SZ = 230,
      ctx = toyCanvas(cv, SZ),
      CX = 115,
      CY = 116,
      R = 92;
    var ang = 0,
      vel = 0,
      spinning = false,
      items = [],
      lastSeg = 0;
    function pool() {
      var favs = (favorites || []).filter(function (n) {
        return serverNames.indexOf(n) >= 0;
      });
      var src = favs.length ? favs : serverNames || [];
      return src.slice(0, 12);
    }
    function draw() {
      ctx.clearRect(0, 0, SZ, SZ);
      var n = items.length;
      if (!n) {
        ctx.fillStyle = "rgba(255,255,255,.06)";
        ctx.beginPath();
        ctx.arc(CX, CY, R - 8, 0, 6.284);
        ctx.fill();
        ctx.fillStyle = "rgba(190,210,225,.6)";
        ctx.font = "600 12px system-ui,Segoe UI,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("нет серверов", CX, CY);
        drawPin();
        return;
      }
      var seg = 6.283185 / n;
      for (var i = 0; i < n; i++) {
        var a0 = ang + i * seg,
          a1 = a0 + seg;
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, R - 8, a0, a1);
        ctx.closePath();
        var hue = Math.round(168 + (i / n) * 190);
        ctx.fillStyle = "hsl(" + hue + " 62% " + (i % 2 ? 44 : 53) + "%)";
        ctx.fill();
        ctx.strokeStyle = "rgba(8,14,20,.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
        var midA = a0 + seg / 2;
        var midR = (R - 8) * 0.6;
        var lx = CX + Math.cos(midA) * midR,
          ly = CY + Math.sin(midA) * midR;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        var short =
          (cleanName(items[i]).match(/[A-Za-zА-Яа-яЁё0-9]/g) || [])
            .slice(0, 2)
            .join("")
            .toUpperCase() || "?";
        ctx.font = "700 15px system-ui,sans-serif";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(10,14,18,.85)";
        ctx.strokeText(short, lx, ly);
        ctx.fillStyle = "#fff";
        ctx.fillText(short, lx, ly);
      }
      ctx.fillStyle = "#16202a";
      ctx.beginPath();
      ctx.arc(CX, CY, 15, 0, 6.284);
      ctx.fill();
      ctx.strokeStyle = "rgba(120,230,240,.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, CY, 15, 0, 6.284);
      ctx.stroke();
      ctx.fillStyle = "rgba(160,235,245,.9)";
      ctx.font = "700 11px system-ui,Segoe UI,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n), CX, CY);
      drawPin();
    }
    function drawPin() {
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.moveTo(CX, CY - R + 16);
      ctx.lineTo(CX - 9, CY - R - 2);
      ctx.lineTo(CX + 9, CY - R - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    function current() {
      var n = items.length;
      if (!n) return -1;
      var seg = 6.283185 / n;
      var a = (-Math.PI / 2 - ang) % 6.283185;
      if (a < 0) a += 6.283185;
      return Math.floor(a / seg) % n;
    }
    function step(dt) {
      if (spinning) {
        ang += vel * dt;
        vel *= Math.exp(-dt * 0.9);
        var n = items.length;
        if (n) {
          var seg = Math.floor(ang / (6.283185 / n));
          if (seg !== lastSeg) {
            lastSeg = seg;
            if (Math.abs(vel) > 0.8)
              toyBlip(S.rouSnd, "square", 1500, 1200, Math.min(0.05, Math.abs(vel) / 260), 0.03);
          }
        }
        if (Math.abs(vel) < 0.12) {
          vel = 0;
          spinning = false;
          finish();
        }
      }
      draw();
      return spinning;
    }
    var kick = toyLoop("roulette", step);
    async function finish() {
      var i = current();
      if (i < 0) return;
      var name = items[i];
      var el = $("rouName");
      if (el) el.textContent = cleanName(name);
      toyBlip(S.rouSnd, "triangle", 700, 1400, 0.11, 0.22);
      if (!api.selectProxy || !curGroup) {
        toast("Выпало: " + cleanName(name));
        return;
      }
      var r = await api.selectProxy(curGroup, name);
      if (r && r.ok) {
        if ($("hsrv")) $("hsrv").textContent = cleanName(name);
        try {
          setSrvFlag(name);
        } catch (_) {}
        toast("Колесо выбрало: " + cleanName(name) + " ✓");
      } else toast("Выпало: " + cleanName(name) + ", но переключить не вышло");
    }
    function spin() {
      if (spinning) return;
      items = pool();
      if (!items.length) {
        toast("Сначала добавьте подписку");
        draw();
        return;
      }
      spinning = true;
      vel = 9 + Math.random() * 7;
      lastSeg = 0;
      toyBlip(S.rouSnd, "sawtooth", 260, 520, 0.09, 0.18);
      var el = $("rouName");
      if (el) el.textContent = "крутится…";
      kick();
    }
    if ($("rouSpin"))
      $("rouSpin").onclick = function (e) {
        e.stopPropagation();
        spin();
      };
    cv.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      spin();
    });
    var snd = $("rouSnd");
    function sndUi() {
      if (snd) snd.className = "ti " + (S.rouSnd === false ? "ti-volume-off" : "ti-volume");
    }
    if (snd)
      snd.onclick = function (e) {
        e.stopPropagation();
        persist({ rouSnd: S.rouSnd === false ? true : false });
        sndUi();
        toast(S.rouSnd === false ? "Звук колеса выключен" : "Звук колеса включён");
      };
    refreshRoulette = function () {
      if (!spinning) {
        items = pool();
        draw();
      }
    };
    setTimeout(function () {
      sndUi();
      refreshRoulette();
    }, 1400);
    draw();
  })();
  (function initSnowman() {
    var cv = $("snowCv");
    if (!cv) return;
    var SZ = 230,
      ctx = toyCanvas(cv, SZ),
      CX = 115;
    var pats = 0,
      patsTimer = null;
    var t = 0,
      squash = 0,
      hatY = 0,
      hatV = 0,
      blink = 0,
      nextBlink = 2 + Math.random() * 3;
    var lookX = 0,
      lookY = 0,
      tgtX = 0,
      tgtY = 0,
      puffs = [];
    function step(dt) {
      t += dt;
      squash *= Math.exp(-dt * 6);
      hatV += 520 * dt;
      hatY += hatV * dt;
      if (hatY > 0) {
        hatY = 0;
        hatV = 0;
      }
      lookX += (tgtX - lookX) * Math.min(1, dt * 8);
      lookY += (tgtY - lookY) * Math.min(1, dt * 8);
      nextBlink -= dt;
      if (nextBlink <= 0) {
        blink = 0.14;
        nextBlink = 2.4 + Math.random() * 3.5;
      }
      if (blink > 0) blink -= dt;
      for (var i = puffs.length - 1; i >= 0; i--) {
        var p = puffs[i];
        p.life -= dt;
        if (p.life <= 0) {
          puffs.splice(i, 1);
          continue;
        }
        p.vy += 120 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-dt * 1.4);
      }
      draw();
    }
    function draw() {
      ctx.clearRect(0, 0, SZ, SZ);
      var bob = Math.sin(t * 1.7) * 2.2;
      var sq = squash;
      var groundY = 196;
      ctx.fillStyle = "rgba(0,0,0,.22)";
      ctx.beginPath();
      ctx.ellipse(CX, groundY + 4, 44 - sq * 6, 8, 0, 0, 6.284);
      ctx.fill();
      ctx.fillStyle = "rgba(230,245,252,.16)";
      ctx.beginPath();
      ctx.moveTo(CX - 74, groundY + 8);
      ctx.quadraticCurveTo(CX, groundY - 14, CX + 74, groundY + 8);
      ctx.lineTo(CX + 74, groundY + 16);
      ctx.lineTo(CX - 74, groundY + 16);
      ctx.closePath();
      ctx.fill();
      var rb = 38 + sq * 5,
        botY = groundY - rb + sq * 4 + bob * 0.3;
      var rm = 27 - sq * 1.5,
        midY = botY - rb - rm + 16 + sq * 5 + bob * 0.6;
      var rh = 19 - sq * 1,
        headY = midY - rm - rh + 12 + sq * 6 + bob;
      ctx.strokeStyle = "#8a6141";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      var armA = Math.sin(t * 1.7) * 0.06;
      [
        [-1, -0.5 - armA],
        [1, -0.5 + armA],
      ].forEach(function (a) {
        var sx = CX + a[0] * (rm - 4),
          sy = midY + 2;
        var ex = CX + a[0] * (rm + 26),
          ey = midY - 16 + a[1] * 12;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + a[0] * 8, ey - 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + a[0] * 7, ey + 5);
        ctx.stroke();
      });
      function ball(x, y, r) {
        var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.65, "#eef7fb");
        g.addColorStop(1, "#c6d9e3");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.284);
        ctx.fill();
      }
      ball(CX, botY, rb);
      ball(CX, midY, rm);
      ball(CX, headY, rh);
      ctx.fillStyle = "#26323c";
      [0, 1, 2].forEach(function (i) {
        ctx.beginPath();
        ctx.arc(CX, midY - 9 + i * 9, 2.2, 0, 6.284);
        ctx.fill();
      });
      ctx.fillStyle = "#ff6b8a";
      ctx.fillRect(CX - rh - 2, headY + rh - 5, (rh + 2) * 2, 7);
      ctx.beginPath();
      ctx.moveTo(CX + rh - 6, headY + rh + 1);
      ctx.lineTo(CX + rh + 3, headY + rh + 22);
      ctx.lineTo(CX + rh - 5, headY + rh + 21);
      ctx.closePath();
      ctx.fill();
      var ex1 = CX - 6.5 + lookX * 2.2,
        ex2 = CX + 6.5 + lookX * 2.2,
        ey = headY - 3 + lookY * 2;
      ctx.fillStyle = "#26323c";
      if (blink > 0) {
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = "#26323c";
        ctx.beginPath();
        ctx.moveTo(ex1 - 3, ey);
        ctx.lineTo(ex1 + 3, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex2 - 3, ey);
        ctx.lineTo(ex2 + 3, ey);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(ex1, ey, 2.7, 0, 6.284);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex2, ey, 2.7, 0, 6.284);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.beginPath();
        ctx.arc(ex1 - 0.9, ey - 0.9, 0.9, 0, 6.284);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex2 - 0.9, ey - 0.9, 0.9, 0, 6.284);
        ctx.fill();
      }
      ctx.fillStyle = "#ff9e4d";
      ctx.beginPath();
      ctx.moveTo(CX + lookX * 2, headY + 1 + lookY * 2);
      ctx.lineTo(CX + 15 + lookX * 3, headY + 4 + lookY * 2);
      ctx.lineTo(CX + lookX * 2, headY + 6 + lookY * 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#26323c";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(CX + lookX, headY + 6 + lookY, 7, 0.35, 2.79);
      ctx.stroke();
      var hy = headY - rh - 4 + hatY;
      ctx.fillStyle = "#2f7f8c";
      ctx.fillRect(CX - 22, hy, 44, 5);
      ctx.fillStyle = "#3aa0b0";
      ctx.fillRect(CX - 13, hy - 20, 26, 21);
      ctx.fillStyle = "rgba(255,255,255,.22)";
      ctx.fillRect(CX - 13, hy - 7, 26, 4);
      for (var i = 0; i < puffs.length; i++) {
        var p = puffs[i];
        ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.85;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.284);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    var kick = toyLoop("snowman", step);
    function rel(e) {
      var r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * SZ, y: ((e.clientY - r.top) / r.height) * SZ };
    }
    cv.addEventListener("pointermove", function (e) {
      var p = rel(e);
      tgtX = Math.max(-1, Math.min(1, (p.x - CX) / 60));
      tgtY = Math.max(-1, Math.min(1, (p.y - 120) / 70));
      kick();
    });
    cv.addEventListener("pointerleave", function () {
      tgtX = 0;
      tgtY = 0;
      kick();
    });
    cv.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var p = rel(e);
      squash = 1;
      hatV = -190;
      for (var i = 0; i < 10; i++) {
        var a = Math.random() * 6.284;
        puffs.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(a) * (30 + Math.random() * 70),
          vy: Math.sin(a) * 55 - 45,
          r: 1.6 + Math.random() * 3,
          life: 0.5 + Math.random() * 0.4,
          max: 0.9,
        });
      }
      pats++;
      ui();
      toyBlip(S.snowSnd, "sine", 420 + Math.random() * 90, 210, 0.09, 0.13);
      toyHiss(S.snowSnd, 0.02, 2200, 0.12);
      clearTimeout(patsTimer);
      patsTimer = setTimeout(function () {
        persist({ snowPats: pats });
      }, 1200);
      kick();
    });
    function plural(n) {
      var a = n % 10,
        b = n % 100;
      if (a === 1 && b !== 11) return "поглаживание";
      if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "поглаживания";
      return "поглаживаний";
    }
    function ui() {
      if ($("snowPats")) $("snowPats").textContent = String(pats);
      if ($("snowPatsWord")) $("snowPatsWord").textContent = plural(pats);
    }
    var snd = $("snowSnd");
    function sndUi() {
      if (snd) snd.className = "ti " + (S.snowSnd === false ? "ti-volume-off" : "ti-volume");
    }
    if (snd)
      snd.onclick = function (e) {
        e.stopPropagation();
        persist({ snowSnd: S.snowSnd === false ? true : false });
        sndUi();
        toast(S.snowSnd === false ? "Звук снеговика выключен" : "Звук снеговика включён");
      };
    setTimeout(function () {
      sndUi();
      if (S.snowPats > 0) {
        pats = S.snowPats;
        ui();
      }
    }, 1200);
    draw();
  })();
  function fillSubWidgets(subs, activeId) {
    var s =
      (subs || []).filter(function (x) {
        return x.id === activeId;
      })[0] || (subs || [])[0];
    if ($("subbarName"))
      $("subbarName").textContent = s ? cleanName(s.name || "Подписка") : "Подписка";
    if (s && s.userinfo && $("subbarFill")) {
      var u = s.userinfo,
        pct = u.total > 0 ? Math.min(100, (u.used / u.total) * 100) : 0;
      $("subbarFill").style.width = (u.total > 0 ? pct : 100) + "%";
      $("subbarText").textContent =
        u.total > 0 ? fmtGB(u.used) + " / " + fmtGB(u.total) : "Безлимит";
      $("subbarDays").textContent = fmtDays(u.expire);
    } else if ($("subbarText")) {
      $("subbarText").textContent = "Нет данных";
      $("subbarDays").textContent = "";
    }
    var su = s && s.supportUrl;
    if ($("supportCard"))
      $("supportCard").onclick = function () {
        if (api.openExternal) api.openExternal(su || "https://snowservice.github.io/snowvpn/");
      };
    if ($("supportVal"))
      $("supportVal").textContent = su ? su.replace(/^https?:\/\//, "") : "Написать в поддержку";
    if ($("subbarUpd") && s)
      $("subbarUpd").onclick = async function (ev) {
        ev.stopPropagation();
        var ic = this;
        ic.style.pointerEvents = "none";
        ic.classList.add("spin");
        var x = api.updateSub ? await api.updateSub(s.id) : { ok: false };
        if (x && x.ok) {
          toast("Подписка обновлена ✓");
          loadSub();
          loadServers();
        } else toast("Ошибка: " + ((x && x.error) || "—"));
        ic.style.pointerEvents = "";
        ic.classList.remove("spin");
      };
  }
  function showDisclaimer() {
    var el = $("disclaimer");
    if (!el) return;
    el.style.display = "flex";
    var open = function (u) {
      return function (e) {
        e.preventDefault();
        if (api.openExternal) api.openExternal(u);
      };
    };
    $("dlPrivacy").onclick = open("https://snowservice.cc/privacy/");
    $("dlTerms").onclick = open("https://snowservice.cc/terms");
    $("dlAccept").onclick = function () {
      el.style.display = "none";
      persist({ disclaimerAccepted: true });
      showOnboarding();
    };
  }
  var OB_SLIDES = [
    {
      icon: "ti-route",
      title: "Режимы TUN и Прокси",
      text: "В режиме <b>TUN</b> весь трафик системы (игры, браузеры, фон) идёт через VPN автоматически — это надёжный вариант по умолчанию. В режиме <b>Прокси</b> через VPN идут только приложения, которые вы сами настроили. Переключить можно в верхней панели.",
    },
    {
      icon: "ti-sparkles",
      title: "AI-DNS для Gemini и AI Studio",
      text: "Если не открывается Google Gemini или AI Studio — включите переключатель <b>AI-DNS</b> в Настройках. Он использует отдельный DNS специально для AI-сервисов, не затрагивая остальной трафик.",
    },
    {
      icon: "ti-shield-lock",
      title: "Kill Switch",
      text: "<b>Kill Switch</b> блокирует доступ в интернет, если VPN неожиданно отключится — это защищает от утечки реального IP. Включается одним переключателем в Настройках.",
    },
    {
      icon: "ti-palette",
      title: "Тема и акцентный цвет",
      text: "Оформление приложения полностью настраивается: тёмная/светлая тема и акцентный цвет — в разделе Настройки → «Тема оформления». Можно выбрать свой цвет из палитры.",
    },
  ];
  function showOnboarding() {
    if (S.onboardingSeen) return;
    var el = $("onboard");
    if (!el) return;
    var i = 0;
    function render() {
      var s = OB_SLIDES[i];
      $("obIcon").className = "ti " + s.icon;
      $("obTitle").textContent = s.title;
      $("obText").innerHTML = s.text;
      $("obDots").innerHTML = OB_SLIDES.map(function (_, idx) {
        return (
          '<div style="width:' +
          (idx === i ? "18px" : "6px") +
          ";height:6px;border-radius:3px;background:" +
          (idx === i ? "var(--cy)" : "var(--stroke)") +
          ';transition:.25s"></div>'
        );
      }).join("");
      $("obNext").innerHTML =
        i === OB_SLIDES.length - 1 ? '<i class="ti ti-check"></i>Понятно' : "Далее";
    }
    function finish() {
      el.style.display = "none";
      persist({ onboardingSeen: true });
    }
    $("obSkip").onclick = finish;
    $("obNext").onclick = function () {
      if (i < OB_SLIDES.length - 1) {
        i++;
        render();
      } else finish();
    };
    el.style.display = "flex";
    render();
  }
  (async function init() {
    if (api.getSettings) {
      try {
        Object.assign(S, await api.getSettings());
        applyTheme(S);
      } catch (e) {}
    }
    try {
      loadLayout();
      wireHomeEdit();
    } catch (e) {}
    if (!S.disclaimerAccepted) showDisclaimer();
    else showOnboarding();
    if (S.srvSort) $("srvSort").value = S.srvSort;
    if (S.pingMethod) $("pingMethod").value = S.pingMethod;
    if (S.currentServer) {
      $("hsrv").textContent = cleanName(S.currentServer);
      setSrvFlag(S.currentServer);
    }
    try {
      api.diag && api.diag("init reached rules block");
    } catch (_) {}
    if (api.getRules) {
      try {
        var rr = await api.getRules();
        try {
          api.diag &&
            api.diag(
              "getRules ok len=" +
                (Array.isArray(rr) ? rr.length : "n/a") +
                " seeded=" +
                S.rulesSeeded,
            );
        } catch (_) {}
        rulesData = Array.isArray(rr) ? rr : [];
        if (!S.rulesSeeded) {
          S.rulesSeeded = true;
          if (api.saveSettings) api.saveSettings({ rulesSeeded: true });
        }
        renderRules();
        profInit();
      } catch (e) {}
    }
    if (api.getState) {
      try {
        applyState(await api.getState());
      } catch (e) {}
    }
    if (api.about && $("aboutVer")) {
      try {
        var ab = await api.about();
        $("aboutVer").textContent =
          "SnowVPN v" + (ab.version || "") + " · ядро " + (ab.core || "mihomo 1.19.27");
      } catch (e) {}
    }
    initSettings();
    refreshIp();
    if (api.onSubChanged)
      api.onSubChanged(function () {
        loadSub();
        loadServers();
        toast("Подписка обновлена");
      });
    if (api.onDeeplinkAdded)
      api.onDeeplinkAdded(function (name) {
        go("subs");
        loadSub();
        loadServers();
        toast("Подписка «" + name + "» добавлена ✓");
      });
    if (api.onDeeplinkError)
      api.onDeeplinkError(function (msg) {
        toast("Не удалось добавить подписку: " + msg);
      });
    if (api.onRuleInvalid)
      api.onRuleInvalid(function (data) {
        var names = data && data.names;
        if (data && Array.isArray(data.rules)) {
          rulesData = data.rules;
          renderRules();
        }
        toast(
          names && names.length
            ? "Отключено невалидное правило: " + names.join(", ")
            : "Одно из правил оказалось некорректным — проверьте раздел «Правила»",
        );
      });
    if (api.onRulesChanged)
      api.onRulesChanged(function (rules) {
        if (Array.isArray(rules)) {
          rulesData = rules;
          renderRules();
        }
        toast("Сервер из правила удалён — правило переведено на выбранный сервер");
      });
    if (api.onHwidLimit)
      api.onHwidLimit(function (d) {
        var m = $("hwidModal");
        if (!m || !d) return;
        $("hwidText").textContent = d.text || "";
        var sup = $("hwidSupport");
        if (d.supportUrl) {
          sup.style.display = "";
          sup.onclick = function (e) {
            e.preventDefault();
            if (api.openExternal) api.openExternal(d.supportUrl);
            m.style.display = "none";
          };
        } else {
          sup.style.display = "none";
        }
        m.style.display = "flex";
      });
    if ($("hwidManage"))
      $("hwidManage").onclick = function (e) {
        e.preventDefault();
        if (api.openExternal) api.openExternal("tg://resolve?domain=SnowfallVPN_bot&startapp=lk");
        $("hwidModal").style.display = "none";
      };
    if ($("hwidConfirm"))
      $("hwidConfirm").onclick = function (e) {
        e.preventDefault();
        $("hwidModal").style.display = "none";
      };
    setTimeout(async function () {
      try {
        var r = api.updateCheck ? await api.updateCheck() : null;
        if (r && r.ok && r.available) {
          if ($("updLbl"))
            $("updLbl").textContent = "Доступна версия " + r.version + " — нажмите «Проверить»";
          if (S.updateSnoozed !== r.version) showUpdateBanner(r);
        }
      } catch (e) {}
    }, 4e3);
  })();
})();
