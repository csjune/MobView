var background = {
  "message": {},
  "receive": function (id, callback) {
    background.message[id] = callback;
  },
  "send": function (id, data) {
    chrome.runtime.sendMessage({"method": id, "data": data, "path": "options-to-background"}, function () {
      return chrome.runtime.lastError;
    });
  }
};

chrome.runtime.onMessage.addListener(function (request) {
  if (request && request.path === "background-to-options") {
    const handler = background.message[request.method];
    if (typeof handler === "function") handler(request.data);
  }
});

var options = (function () {
  let timer = null;
  let announceTimer = null;
  let loaded = false;
  let dirty = false;
  let resetPending = false;
  let lastSent = null;
  /*  */
  const clearTimer = function () {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  /*  */
  const clearAnnounceTimer = function () {
    if (announceTimer !== null) {
      clearTimeout(announceTimer);
      announceTimer = null;
    }
  };
  /*  */
  const normalizeUA = function (val) {
    return String(val == null ? "" : val).replace(/[\r\n\t]+/g, " ");
  };
  /*  */
  const isPrintableAscii = function (val) {
    const trimmed = normalizeUA(val).trim();
    return trimmed === "" || /^[\x20-\x7E]+$/.test(trimmed);
  };
  /*  */
  const setInvalid = function (el, invalid, announce) {
    const wasValid = el.getAttribute("aria-invalid") !== "true";
    const errorId = el.getAttribute("data-error") || "useragent-error";
    const errorEl = document.getElementById(errorId);
    const announcer = document.getElementById("status-announcer");
    /*  */
    el.setAttribute("aria-invalid", invalid ? "true" : "false");
    const ids = (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (id) {
      return id && id !== errorId;
    });
    if (invalid) ids.push(errorId);
    if (ids.length) {
      el.setAttribute("aria-describedby", ids.join(" "));
    } else {
      el.removeAttribute("aria-describedby");
    }
    if (errorEl) errorEl.hidden = !invalid;
    /*  */
    if (!invalid) {
      clearAnnounceTimer();
      if (announcer) announcer.textContent = "";
      return;
    }
    if (announce && wasValid && announcer) {
      clearAnnounceTimer();
      announcer.textContent = "";
      announceTimer = setTimeout(function () {
        announceTimer = null;
        announcer.textContent = errorEl ? errorEl.textContent : "";
      }, 500);
      if (announceTimer && typeof announceTimer.unref === "function") announceTimer.unref();
    }
  };
  /*  */
  const schedule = function () {
    const el = document.getElementById("useragent");
    clearTimer();
    resetPending = false;
    if (isPrintableAscii(el.value)) setInvalid(el, false, false);
    if (el.value === lastSent) {
      dirty = false;
      return;
    }
    dirty = true;
    /* Wait for commit/leave before resetting an empty box so pausing before paste doesn't refill the default. */
    if (isPrintableAscii(el.value) && normalizeUA(el.value).trim() !== "") {
      timer = setTimeout(flush, 300);
    }
  };
  /*  */
  const flush = function () {
    const el = document.getElementById("useragent");
    clearTimer();
    const cleaned = normalizeUA(el.value);
    if (cleaned !== el.value) el.value = cleaned;
    if (!isPrintableAscii(cleaned)) {
      setInvalid(el, true, true);
      return;
    }
    setInvalid(el, false, false);
    dirty = false;
    if (cleaned === lastSent) return;
    loaded = true;
    lastSent = cleaned;
    resetPending = cleaned.trim() === "";
    background.send("useragent", {"useragent": cleaned});
  };
  /*  */
  return {
    "renderSettings": function (e) {
      document.getElementById("bypass-cache").checked = e.bypassCache;
      /*  */
      const el = document.getElementById("useragent");
      const focused = document.activeElement === el;
      if ((!focused && timer === null) || (!loaded && !dirty) || (resetPending && el.value.trim() === "")) {
        el.value = e.useragent;
        setInvalid(el, false, false);
        loaded = true;
        dirty = false;
        resetPending = false;
        lastSent = e.useragent;
      }
    },
    "showUserAgentInvalid": function () {
      const el = document.getElementById("useragent");
      if (el) setInvalid(el, true, true);
    },
    "renderSites": function (sites) {
      const ul = document.getElementById("sites");
      ul.textContent = "";
      /*  */
      if (!sites || !sites.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No sites yet. Click the toolbar button on a site to add it.";
        ul.appendChild(li);
        return;
      }
      /*  */
      sites.forEach(function (site) {
        const li = document.createElement("li");
        const span = document.createElement("span");
        const button = document.createElement("button");
        /*  */
        span.textContent = site;
        button.type = "button";
        button.textContent = "Remove";
        button.setAttribute("aria-label", "Remove " + site);
        button.addEventListener("click", function () {
          background.send("removeSite", {"site": site});
        });
        /*  */
        li.append(span, button);
        ul.appendChild(li);
      });
    },
    "init": function () {
      const useragent = document.getElementById("useragent");
      if (useragent.getAttribute("aria-invalid") === null) {
        useragent.setAttribute("aria-invalid", "false");
      }
      document.getElementById("bypass-cache").addEventListener("change", function (e) {
        background.send("bypassCache", {"bypassCache": e.target.checked});
      });
      useragent.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.isComposing || e.keyCode === 229) return;
          flush();
        }
      });
      useragent.addEventListener("input", schedule);
      useragent.addEventListener("change", flush);
      useragent.addEventListener("blur", flush);
      if (typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "hidden") flush();
        });
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pagehide", flush);
      }
      /*  */
      background.send("load");
    }
  };
})();

background.receive("settings", options.renderSettings);
background.receive("sites", options.renderSites);
background.receive("useragentInvalid", options.showUserAgentInvalid);
options.init();
