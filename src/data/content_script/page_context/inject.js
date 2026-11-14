{
  const fallback = typeof mobviewDefaultUserAgent === "string"
    ? mobviewDefaultUserAgent
    : "Mozilla/5.0 (Android 15; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0";
  const reflectApply = Reflect.apply;
  const callBind = Function.prototype.bind.bind(Function.prototype.call);
  const isPrototypeOf = callBind(Object.prototype.isPrototypeOf);
  const hasOwn = callBind(Object.prototype.hasOwnProperty);
  const defineProperty = Object.defineProperty;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const strIndexOf = callBind(String.prototype.indexOf);
  const strStartsWith = callBind(String.prototype.startsWith);
  const strSlice = callBind(String.prototype.slice);
  const strTrim = callBind(String.prototype.trim);
  const strToLowerCase = callBind(String.prototype.toLowerCase);
  const arrIsArray = Array.isArray;
  const promiseResolve = Promise.resolve.bind(Promise);
  const promiseReject = Promise.reject.bind(Promise);
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
  const navUADataDesc = getOwnPropertyDescriptor(navProto, "userAgentData");
  const ownUADataDesc = navProto !== navigator ? getOwnPropertyDescriptor(navigator, "userAgentData") : null;
  const origUADataGet = navUADataDesc && navUADataDesc.get;
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
  let cachedUA = null;
  let cachedValues = null;
  /*  */
  const stripTrailingDots = function (s) {
    let end = s.length;
    while (end > 0 && strSlice(s, end - 1, end) === ".") {
      end -= 1;
    }
    return strSlice(s, 0, end);
  };
  /*  */
  const extractTokenAfter = function (str, prefix) {
    const idx = strIndexOf(str, prefix);
    if (idx === -1) return "";
    const start = idx + prefix.length;
    let end = start;
    while (end < str.length) {
      const ch = strSlice(str, end, end + 1);
      if (ch === " " || ch === ";" || ch === ")") break;
      end += 1;
    }
    return strSlice(str, start, end);
  };
  /*  */
  const majorOf = function (ver) {
    const dot = strIndexOf(ver, ".");
    return dot !== -1 ? strSlice(ver, 0, dot) : ver;
  };
  /*  */
  const padPlatformVersion = function (ver) {
    if (!ver) return "";
    let dots = 0;
    let pos = strIndexOf(ver, ".");
    while (pos !== -1) {
      dots += 1;
      pos = strIndexOf(ver, ".", pos + 1);
    }
    if (dots === 0) return ver + ".0.0";
    if (dots === 1) return ver + ".0";
    return ver;
  };
  /*  */
  const extractAndroidModel = function (useragent, androidStart) {
    const start = androidStart + 8;
    const semi = strIndexOf(useragent, ";", start);
    const close = strIndexOf(useragent, ")", start);
    if (semi === -1 || (close !== -1 && close < semi)) return "";
    const modelStart = semi + 1;
    const nextSemi = strIndexOf(useragent, ";", modelStart);
    const nextClose = strIndexOf(useragent, ")", modelStart);
    let modelEnd = useragent.length;
    if (nextSemi !== -1 && (nextClose === -1 || nextSemi < nextClose)) {
      modelEnd = nextSemi;
    } else if (nextClose !== -1) {
      modelEnd = nextClose;
    }
    let token = strSlice(useragent, modelStart, modelEnd);
    const bIdx = strIndexOf(token, " Build/");
    if (bIdx !== -1) token = strSlice(token, 0, bIdx);
    return strTrim(token);
  };
  /* navigator values that have to agree with the spoofed user-agent */
  const computeSpoof = function (useragent) {
    if (useragent === cachedUA && cachedValues) return cachedValues;
    /*  */
    const hasIPad = strIndexOf(useragent, "iPad") !== -1;
    const hasIPod = strIndexOf(useragent, "iPod") !== -1;
    const hasIPhone = strIndexOf(useragent, "iPhone") !== -1;
    const ios = hasIPad || hasIPod || hasIPhone;
    const android = strIndexOf(useragent, "Android") !== -1;
    const chrome = strIndexOf(useragent, "Chrome/") !== -1 || strIndexOf(useragent, "Chromium/") !== -1;
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
    let uaData;
    if (chrome) {
      const chromeFull = extractTokenAfter(useragent, "Chrome/") || extractTokenAfter(useragent, "Chromium/") || "157.0.0.0";
      const chromeMajor = majorOf(chromeFull) || "157";
      const edgeFull = extractTokenAfter(useragent, "EdgA/") || extractTokenAfter(useragent, "Edg/");
      const brandName = edgeFull ? "Microsoft Edge" : "Google Chrome";
      const brandFull = edgeFull || chromeFull;
      const brandMajor = majorOf(brandFull) || chromeMajor;
      const uaMobile = strIndexOf(useragent, "Mobile") !== -1 || hasIPhone || hasIPod;
      const uaPlatform = android ? "Android" : (ios ? "iOS" : (strIndexOf(useragent, "Windows") !== -1 ? "Windows" : (strIndexOf(useragent, "Macintosh") !== -1 ? "macOS" : (strIndexOf(useragent, "CrOS") !== -1 ? "Chrome OS" : (strIndexOf(useragent, "Linux") !== -1 ? "Linux" : "Android")))));
      let uaPlatformVersion = "";
      let uaModel = "";
      if (android) {
        const aIdx = strIndexOf(useragent, "Android ");
        if (aIdx !== -1) {
          const verStart = aIdx + 8;
          const semi = strIndexOf(useragent, ";", verStart);
          const close = strIndexOf(useragent, ")", verStart);
          let verEnd = useragent.length;
          if (semi !== -1 && (close === -1 || semi < close)) {
            verEnd = semi;
          } else if (close !== -1) {
            verEnd = close;
          }
          uaPlatformVersion = padPlatformVersion(strTrim(strSlice(useragent, verStart, verEnd)));
          uaModel = extractAndroidModel(useragent, aIdx);
        }
      }
      const makeBrands = function () {
        return [
          {"brand": "Not/A)Brand", "version": "8"},
          {"brand": "Chromium", "version": chromeMajor},
          {"brand": brandName, "version": brandMajor}
        ];
      };
      const makeFullVersionList = function () {
        return [
          {"brand": "Not/A)Brand", "version": "8.0.0.0"},
          {"brand": "Chromium", "version": chromeFull},
          {"brand": brandName, "version": brandFull}
        ];
      };
      uaData = {
        get brands() { return makeBrands(); },
        get mobile() { return uaMobile; },
        get platform() { return uaPlatform; },
        "toJSON": function () {
          return {"brands": makeBrands(), "mobile": uaMobile, "platform": uaPlatform};
        },
        "getHighEntropyValues": function (hints) {
          if (!arrIsArray(hints)) {
            return promiseReject(new TypeError("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': The provided value cannot be converted to a sequence."));
          }
          const out = {"brands": makeBrands(), "mobile": uaMobile, "platform": uaPlatform};
          for (let i = 0; i < hints.length; i += 1) {
            const hint = hints[i];
            if (hint === "architecture") out.architecture = "";
            else if (hint === "bitness") out.bitness = "";
            else if (hint === "formFactors") out.formFactors = [uaMobile ? "Mobile" : "Tablet"];
            else if (hint === "fullVersionList") out.fullVersionList = makeFullVersionList();
            else if (hint === "model") out.model = uaModel;
            else if (hint === "platformVersion") out.platformVersion = uaPlatformVersion;
            else if (hint === "uaFullVersion") out.uaFullVersion = chromeFull;
            else if (hint === "wow64") out.wow64 = false;
          }
          return promiseResolve(out);
        }
      };
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
      "firefox": firefox,
      "chrome": chrome,
      "userAgentData": chrome ? uaData : undefined
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
  const uaDataGetter = function () {
    let realValue;
    if (typeof origUADataGet === "function") {
      realValue = reflectApply(origUADataGet, this, []);
    } else {
      checkBrand(this);
      realValue = navUADataDesc ? navUADataDesc.value : undefined;
    }
    if (!activeUA) return realValue;
    return computeSpoof(activeUA).userAgentData;
  };
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
      if (navUADataDesc) {
        defineProperty(navProto, "userAgentData", navUADataDesc);
      } else {
        delete navProto.userAgentData;
      }
      if (navProto !== navigator) {
        if (ownUADataDesc) {
          defineProperty(navigator, "userAgentData", ownUADataDesc);
        } else {
          delete navigator.userAgentData;
        }
      }
      return;
    }
    /*  */
    const spoofed = computeSpoof(activeUA);
    if (spoofed.firefox) {
      defineProperty(navProto, "oscpu", {"configurable": true, "enumerable": true, "get": oscpuGetter});
      if (hasOwn(navigator, "oscpu") && navProto !== navigator) delete navigator.oscpu;
    } else {
      delete navProto.oscpu;
      if (navProto !== navigator) delete navigator.oscpu;
    }
    if (spoofed.chrome) {
      defineProperty(navProto, "userAgentData", {"configurable": true, "enumerable": true, "get": uaDataGetter});
      if (hasOwn(navigator, "userAgentData") && navProto !== navigator) delete navigator.userAgentData;
    } else {
      delete navProto.userAgentData;
      if (navProto !== navigator) delete navigator.userAgentData;
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
        const locHost = stripTrailingDots(strToLowerCase(location.hostname || ""));
        return Boolean(locHost) && stripTrailingDots(strToLowerCase(new URL(topOrigin).hostname)) === locHost;
      } catch (e) {
        return false;
      }
    }
    if (window.parent === window.top && typeof document !== "undefined" && document.referrer && typeof location !== "undefined") {
      try {
        const locHost = stripTrailingDots(strToLowerCase(location.hostname || ""));
        return Boolean(locHost) && stripTrailingDots(strToLowerCase(new URL(document.referrer).hostname)) === locHost;
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
