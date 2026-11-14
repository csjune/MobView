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
  const schedule = function () {
    const el = document.getElementById("useragent");
    clearTimer();
    resetPending = false;
    if (el.value === lastSent) {
      dirty = false;
      return;
    }
    dirty = true;
    /* Wait for commit/leave before resetting an empty box so pausing before paste doesn't refill the default. */
    if (el.value.trim()) {
      timer = setTimeout(flush, 300);
    }
  };
  /*  */
  const flush = function () {
    const el = document.getElementById("useragent");
    const value = el.value;
    clearTimer();
    dirty = false;
    if (value === lastSent) return;
    loaded = true;
    lastSent = value;
    resetPending = value.trim() === "";
    background.send("useragent", {"useragent": value});
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
        loaded = true;
        dirty = false;
        resetPending = false;
        lastSent = e.useragent;
      }
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
      document.getElementById("bypass-cache").addEventListener("change", function (e) {
        background.send("bypassCache", {"bypassCache": e.target.checked});
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
options.init();
