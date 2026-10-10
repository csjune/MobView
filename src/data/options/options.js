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

var options = {
  "renderSettings": function (e) {
    document.getElementById("bypass-cache").checked = e.bypassCache;
    document.getElementById("useragent").value = e.useragent;
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
      button.addEventListener("click", function () {
        background.send("removeSite", {"site": site});
      });
      /*  */
      li.append(span, button);
      ul.appendChild(li);
    });
  },
  "init": function () {
    document.getElementById("test").addEventListener("click", function () {
      background.send("test");
    });
    document.getElementById("bypass-cache").addEventListener("change", function (e) {
      background.send("bypassCache", {"bypassCache": e.target.checked});
    });
    document.getElementById("useragent").addEventListener("change", function (e) {
      background.send("useragent", {"useragent": e.target.value});
    });
    /*  */
    background.send("load");
  }
};

background.receive("settings", options.renderSettings);
background.receive("sites", options.renderSites);
options.init();
