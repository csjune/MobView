var background = {
  "message": {},
  "receive": function (id, callback) {
    background.message[id] = callback;
  },
  "send": function (id, data, onDone) {
    chrome.runtime.sendMessage({"method": id, "data": data, "path": "options-to-background"}, function (response) {
      const err = chrome.runtime.lastError;
      if (typeof onDone === "function") onDone(err || null, response);
      return err;
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
  const DEFAULT_ERROR = "Error: User-Agent must contain only printable ASCII characters.";
  let defaultErrorText = DEFAULT_ERROR;
  let timer = null;
  let announceTimer = null;
  let loaded = false;
  let dirty = false;
  let resetPending = false;
  let lastSent = null;
  const clientId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  let requestSeq = 0;
  let pendingRequestId = null;
  let pendingRemoval = null;
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
  const announceStatus = function (text) {
    const announcer = document.getElementById("status-announcer");
    if (announcer && document.visibilityState !== "hidden") {
      clearAnnounceTimer();
      announcer.textContent = text;
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
  const mapSelectionIndex = function (raw, index, commit) {
    if (typeof index !== "number" || index < 0) return 0;
    let delta = 0;
    const re = /[\r\n\t]+/g;
    let match;
    while ((match = re.exec(raw)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (index <= start) break;
      if (index >= end) {
        delta += match[0].length - 1;
      } else {
        index = start + 1;
        break;
      }
    }
    let mapped = index - delta;
    if (commit) {
      const cleaned = normalizeUA(raw);
      const leading = cleaned.length - cleaned.trimStart().length;
      const trimmed = cleaned.trim();
      mapped = Math.max(0, Math.min(trimmed.length, mapped - leading));
    }
    return mapped;
  };
  /*  */
  const setInvalid = function (el, invalid, announce, message) {
    const wasInvalid = el.getAttribute("aria-invalid") === "true";
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
    if (errorEl) {
      if (invalid) {
        errorEl.textContent = typeof message === "string" ? message : defaultErrorText;
      } else if (el.id === "useragent") {
        errorEl.textContent = defaultErrorText;
      } else {
        errorEl.textContent = typeof message === "string" ? message : "";
      }
      errorEl.hidden = !invalid;
    }
    /*  */
    if (!invalid) {
      if (wasInvalid) {
        clearAnnounceTimer();
        if (announcer) announcer.textContent = "";
      }
      return;
    }
    if (announce && document.visibilityState !== "hidden" && announcer) {
      clearAnnounceTimer();
      announcer.textContent = "";
      const text = errorEl ? errorEl.textContent : (typeof message === "string" ? message : defaultErrorText);
      announceTimer = setTimeout(function () {
        announceTimer = null;
        if (document.visibilityState !== "hidden") announcer.textContent = text;
      }, 500);
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
      timer = setTimeout(function () {
        flush({"commit": false, "allowEmpty": true});
      }, 300);
    }
  };
  /*  */
  const flush = function (opts) {
    if (!loaded && !dirty) return;
    opts = opts || {};
    const commit = Boolean(opts.commit);
    const allowEmpty = opts.allowEmpty !== false;
    const el = document.getElementById("useragent");
    clearTimer();
    if (!allowEmpty && el.value.trim() === "") return;
    const cleaned = normalizeUA(el.value);
    const trimmed = cleaned.trim();
    const nextValue = commit ? trimmed : cleaned;
    if (nextValue !== el.value) {
      const active = document.activeElement === el;
      const hasSelection = active && typeof el.selectionStart === "number" && typeof el.selectionEnd === "number";
      const newStart = hasSelection ? mapSelectionIndex(el.value, el.selectionStart, commit) : null;
      const newEnd = hasSelection ? mapSelectionIndex(el.value, el.selectionEnd, commit) : null;
      const direction = hasSelection ? el.selectionDirection : null;
      el.value = nextValue;
      if (hasSelection && typeof el.setSelectionRange === "function") {
        if (direction) el.setSelectionRange(newStart, newEnd, direction);
        else el.setSelectionRange(newStart, newEnd);
      }
    }
    if (!isPrintableAscii(trimmed)) {
      setInvalid(el, true, true, defaultErrorText);
      return;
    }
    setInvalid(el, false, false);
    dirty = false;
    if (trimmed === lastSent) return;
    loaded = true;
    lastSent = trimmed;
    resetPending = trimmed === "";
    const reqId = ++requestSeq;
    pendingRequestId = reqId;
    background.send(
      "useragent",
      {"useragent": trimmed, "clientId": clientId, "requestId": reqId},
      function (err, response) {
        if ((err || (response && response.ok === false)) && pendingRequestId === reqId) {
          pendingRequestId = null;
          lastSent = null;
          dirty = true;
          resetPending = false;
        }
      }
    );
  };
  /*  */
  return {
    "renderSettings": function (e) {
      document.getElementById("bypass-cache").checked = e.bypassCache;
      /*  */
      if (pendingRequestId !== null) {
        const isMine = Boolean(e && e.clientId === clientId && e.requestId === pendingRequestId);
        if (!isMine) return;
        pendingRequestId = null;
      }
      /*  */
      const el = document.getElementById("useragent");
      const focused = document.activeElement === el;
      const isInvalid = el.getAttribute("aria-invalid") === "true";
      if ((!loaded && !dirty) || (resetPending && el.value.trim() === "") || (!focused && timer === null && !dirty && !isInvalid)) {
        el.value = e.useragent;
        setInvalid(el, false, false);
        loaded = true;
        dirty = false;
        resetPending = false;
        lastSent = e.useragent;
      } else if (lastSent === "") {
        lastSent = e.useragent;
      }
    },
    "showUserAgentInvalid": function (data) {
      if (data && data.clientId) {
        if (data.clientId !== clientId) return;
        if (pendingRequestId !== null && data.requestId !== pendingRequestId) return;
        if (data.requestId === pendingRequestId) pendingRequestId = null;
      } else if (pendingRequestId !== null) {
        return;
      }
      lastSent = data && typeof data.useragent === "string" ? data.useragent : null;
      dirty = true;
      resetPending = false;
      const el = document.getElementById("useragent");
      const message = data && data.reason === "apply"
        ? "Error: Could not apply User-Agent string."
        : defaultErrorText;
      if (el) setInvalid(el, true, true, message);
    },
    "renderSites": function (sites) {
      const ul = document.getElementById("sites");
      const removed = pendingRemoval && (!sites || sites.indexOf(pendingRemoval.site) === -1)
        ? pendingRemoval
        : null;
      if (removed) pendingRemoval = null;
      const restoreFocus = Boolean(
        removed &&
        (removed.hadFocus || document.activeElement === removed.button) &&
        (!document.activeElement || document.activeElement === removed.button || document.activeElement === document.body)
      );
      ul.textContent = "";
      /*  */
      const buttons = [];
      if (!sites || !sites.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No sites yet. Add a URL above or click the toolbar button on a site.";
        ul.appendChild(li);
      } else {
        sites.forEach(function (site, idx) {
          const li = document.createElement("li");
          const span = document.createElement("span");
          const button = document.createElement("button");
          /*  */
          span.textContent = site;
          button.type = "button";
          button.textContent = "Remove";
          button.setAttribute("aria-label", "Remove " + site);
          button.addEventListener("click", function () {
            pendingRemoval = {
              "site": site,
              "index": idx,
              "button": button,
              "hadFocus": document.activeElement === button
            };
            background.send("removeSite", {"site": site});
          });
          /*  */
          li.append(span, button);
          ul.appendChild(li);
          buttons.push(button);
        });
      }
      /*  */
      if (removed) {
        announceStatus("Removed " + removed.site + ".");
        if (restoreFocus) {
          const target = buttons.length
            ? buttons[Math.min(removed.index, buttons.length - 1)]
            : (document.getElementById("sites-heading") || ul);
          if (target && typeof target.focus === "function") target.focus();
        }
      }
    },
    "init": function () {
      const useragent = document.getElementById("useragent");
      const errorEl = document.getElementById(useragent.getAttribute("data-error") || "useragent-error");
      if (errorEl && errorEl.textContent) defaultErrorText = errorEl.textContent;
      if (useragent.getAttribute("aria-invalid") === null) {
        useragent.setAttribute("aria-invalid", "false");
      }
      document.getElementById("bypass-cache").addEventListener("change", function (e) {
        background.send("bypassCache", {"bypassCache": e.target.checked});
      });
      useragent.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          if (e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          flush({"commit": true, "allowEmpty": true});
        }
      });
      useragent.addEventListener("input", schedule);
      useragent.addEventListener("change", function () {
        flush({"commit": true, "allowEmpty": true});
      });
      useragent.addEventListener("blur", function () {
        flush({"commit": true, "allowEmpty": true});
      });
      if (typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "hidden") {
            flush({"commit": false, "allowEmpty": false});
          }
        });
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("pagehide", function () {
          flush({"commit": true, "allowEmpty": true});
        });
      }
      /*  */
      const addForm = document.getElementById("add-site-form");
      const siteInput = document.getElementById("site-input");
      const addButton = document.getElementById("add-site");
      if (addForm && siteInput && addButton) {
        const invalidSiteMsg = "Error: Enter a valid URL or host (e.g. example.com or https://m.example.com).";
        let isComposingSite = false;
        if (siteInput.getAttribute("aria-invalid") === null) {
          siteInput.setAttribute("aria-invalid", "false");
        }
        siteInput.addEventListener("compositionstart", function () {
          isComposingSite = true;
        });
        siteInput.addEventListener("compositionend", function () {
          isComposingSite = false;
        });
        siteInput.addEventListener("input", function () {
          setInvalid(siteInput, false, false, "");
        });
        addForm.addEventListener("submit", function (e) {
          e.preventDefault();
          if (isComposingSite || addButton.disabled) return;
          if (siteInput.value.trim() === "") {
            setInvalid(siteInput, true, true, invalidSiteMsg);
            if (typeof siteInput.focus === "function") siteInput.focus();
            return;
          }
          let settled = false;
          addButton.disabled = true;
          try {
            background.send("addSite", {"site": siteInput.value}, function (err, resp) {
              settled = true;
              addButton.disabled = false;
              if (err || !resp || !resp.ok) {
                let msg = invalidSiteMsg;
                if (resp && resp.reason === "duplicate" && resp.site) {
                  msg = "Error: " + resp.site + " is already in the list.";
                } else if (resp && resp.reason === "covered" && resp.site && resp.by) {
                  msg = "Error: " + resp.site + " is already covered by " + resp.by + ".";
                } else if (resp && resp.reason === "apply") {
                  msg = "Error: Could not add site.";
                }
                setInvalid(siteInput, true, true, msg);
                if (typeof siteInput.focus === "function") siteInput.focus();
                return;
              }
              siteInput.value = "";
              setInvalid(siteInput, false, false, "");
              if (resp.site) announceStatus("Added " + resp.site + ".");
              if (typeof siteInput.focus === "function") siteInput.focus();
            });
          } catch (sendErr) {
            if (!settled) {
              addButton.disabled = false;
              setInvalid(siteInput, true, true, "Error: Could not add site.");
              if (typeof siteInput.focus === "function") siteInput.focus();
            }
          }
        });
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
