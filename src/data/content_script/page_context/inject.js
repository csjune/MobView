{
  const fallback = typeof mobviewDefaultUserAgent === "string" ? mobviewDefaultUserAgent : null;
  const reflectApply = Reflect.apply;
  const callBind = Function.prototype.bind.bind(Function.prototype.call);
  const isPrototypeOf = callBind(Object.prototype.isPrototypeOf);
  const hasOwn = callBind(Object.prototype.hasOwnProperty);
  const defineProperty = Object.defineProperty;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const strIndexOf = callBind(String.prototype.indexOf);
  const strStartsWith = callBind(String.prototype.startsWith);
  const strSlice = callBind(String.prototype.slice);
  /*  */
  const rawProto = Object.getPrototypeOf(navigator);
  const navProto = (typeof Navigator === "function" && Navigator.prototype) ||
    (rawProto && rawProto !== Object.prototype ? rawProto : navigator);
  /*  */
  const keys = ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints", "oscpu"];
  const descriptors = {};
  keys.forEach(function (key) {
    descriptors[key] = getOwnPropertyDescriptor(navProto, key) || getOwnPropertyDescriptor(navigator, key);
  });
  /*  */
  const hadOscpu = "oscpu" in navigator;
  const navOscpuDesc = getOwnPropertyDescriptor(navProto, "oscpu");
  const origOscpuTarget = navOscpuDesc ? navProto : navigator;
  const origOscpuDesc = navOscpuDesc || getOwnPropertyDescriptor(navigator, "oscpu");
  const hadOwnUAData = hasOwn(navigator, "userAgentData");
  const origUADataDesc = hadOwnUAData ? getOwnPropertyDescriptor(navigator, "userAgentData") : null;
  const original = {
    "userAgent": navigator.userAgent,
    "appVersion": navigator.appVersion,
    "platform": navigator.platform,
    "vendor": navigator.vendor,
    "maxTouchPoints": navigator.maxTouchPoints,
    "oscpu": hadOscpu ? navigator.oscpu : undefined
  };
  /*  */
  let activeUA = null;
  let uaDataOverridden = false;
  let cachedUA = null;
  let cachedValues = null;
  /* navigator values that have to agree with the spoofed user-agent */
  const computeSpoof = function (useragent) {
    if (useragent === cachedUA && cachedValues) return cachedValues;
    /*  */
    const hasIPad = strIndexOf(useragent, "iPad") !== -1;
    const hasIPod = strIndexOf(useragent, "iPod") !== -1;
    const hasIPhone = strIndexOf(useragent, "iPhone") !== -1;
    const ios = hasIPad || hasIPod || hasIPhone;
    const android = strIndexOf(useragent, "Android") !== -1;
    const chrome = strIndexOf(useragent, "Chrome/") !== -1;
    const firefox = !chrome && strIndexOf(useragent, "Firefox/") !== -1;
    const ipadDesktop = !ios && !android && !chrome && !firefox &&
      strIndexOf(useragent, "Macintosh") !== -1 && strIndexOf(useragent, "Safari/") !== -1;
    /* Firefox reports only the first token of the platform part, e.g. "5.0 (Android 15)" */
    let appVersion;
    if (firefox) {
      const open = strIndexOf(useragent, "(");
      if (open !== -1) {
        const semi = strIndexOf(useragent, ";", open + 1);
        const close = strIndexOf(useragent, ")", open + 1);
        let end = useragent.length;
        if (semi !== -1 && (close === -1 || semi < close)) {
          end = semi;
        } else if (close !== -1) {
          end = close;
        }
        appVersion = "5.0 (" + strSlice(useragent, open + 1, end) + ")";
      } else {
        appVersion = "5.0 ()";
      }
    } else {
      appVersion = strStartsWith(useragent, "Mozilla/") ? strSlice(useragent, 8) : useragent;
    }
    /*  */
    cachedUA = useragent;
    cachedValues = {
      "userAgent": useragent,
      "appVersion": appVersion,
      "platform": hasIPad ? "iPad" : (hasIPod ? "iPod" : (hasIPhone ? "iPhone" : (ipadDesktop ? "MacIntel" : (android ? "Linux armv8l" : original.platform)))),
      "vendor": ios || ipadDesktop ? "Apple Computer, Inc." : (chrome ? "Google Inc." : (firefox ? "" : original.vendor)),
      "maxTouchPoints": ios || ipadDesktop || android ? 5 : original.maxTouchPoints,
      "oscpu": android ? "Linux armv8l" : (strIndexOf(useragent, "Linux") !== -1 ? "Linux x86_64" : (original.oscpu || "")),
      "firefox": firefox
    };
    return cachedValues;
  };
  /*  */
  const checkBrand = function (self) {
    if (!self || (self !== navigator && (self === navProto || !isPrototypeOf(navProto, self)))) {
      throw new TypeError("Illegal invocation");
    }
  };
  /*  */
  const makeGetter = function (key) {
    const origGet = descriptors[key] && descriptors[key].get;
    return function () {
      let realValue;
      if (typeof origGet === "function") {
        realValue = reflectApply(origGet, this, []);
      } else {
        checkBrand(this);
        realValue = original[key];
      }
      if (!activeUA) return realValue;
      return computeSpoof(activeUA)[key];
    };
  };
  /*  */
  ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints"].forEach(function (key) {
    defineProperty(navProto, key, {
      "configurable": true,
      "enumerable": true,
      "get": makeGetter(key)
    });
  });
  const oscpuGetter = makeGetter("oscpu");
  /*  */
  const applyUA = function (nextUA) {
    activeUA = nextUA || null;
    if (!activeUA) {
      if (hadOscpu && origOscpuDesc) {
        if (origOscpuTarget !== navProto) delete navProto.oscpu;
        defineProperty(origOscpuTarget, "oscpu", origOscpuDesc);
      } else {
        delete navProto.oscpu;
        if (navProto !== navigator) delete navigator.oscpu;
      }
      if (uaDataOverridden) {
        if (hadOwnUAData && origUADataDesc) {
          defineProperty(navigator, "userAgentData", origUADataDesc);
        } else {
          delete navigator.userAgentData;
        }
        uaDataOverridden = false;
      }
      return;
    }
    /*  */
    if (computeSpoof(activeUA).firefox) {
      defineProperty(navProto, "oscpu", {"configurable": true, "enumerable": true, "get": oscpuGetter});
      if (hasOwn(navigator, "oscpu") && navProto !== navigator) delete navigator.oscpu;
    } else {
      delete navProto.oscpu;
      if (navProto !== navigator) delete navigator.oscpu;
    }
    if (fallback && "userAgentData" in navigator) {
      defineProperty(navigator, "userAgentData", {"configurable": true, "value": undefined});
      uaDataOverridden = true;
    }
  };
  /*  */
  const readSession = function () {
    try {
      return typeof sessionStorage !== "undefined" && sessionStorage ? sessionStorage.getItem("mobview-useragent") : null;
    } catch (e) {
      return null;
    }
  };
  /*  */
  const canUseFallbackImmediately = (function () {
    if (typeof window === "undefined" || !window.top || window === window.top) return true;
    try {
      void window.top.location.href;
      return true;
    } catch (e) {}
    if (typeof location !== "undefined" && location.ancestorOrigins && location.ancestorOrigins.length) {
      const topOrigin = location.ancestorOrigins[location.ancestorOrigins.length - 1];
      if (!topOrigin || topOrigin === "null") return false;
      try {
        return Boolean(location.hostname) && new URL(topOrigin).hostname === location.hostname;
      } catch (e) {
        return false;
      }
    }
    if (window.parent === window.top && typeof document !== "undefined" && document.referrer && typeof location !== "undefined") {
      try {
        return Boolean(location.hostname) && new URL(document.referrer).hostname === location.hostname;
      } catch (e) {
        return false;
      }
    }
    return false;
  })();
  /*  */
  applyUA(readSession() || (canUseFallbackImmediately ? fallback : null));
  /*  */
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const addWinListener = callBind(window.addEventListener);
    const removeWinListener = typeof window.removeEventListener === "function" ? callBind(window.removeEventListener) : function () {};
    const onUA = function (event) {
      if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      removeWinListener(window, "mobview-useragent", onUA, true);
      if (event && typeof event.detail === "string") applyUA(event.detail);
    };
    addWinListener(window, "mobview-useragent", onUA, true);
  }
}
