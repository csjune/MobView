{
  const fallback = "Mozilla/5.0 (Android 15; Mobile; rv:158.0) Gecko/158.0 Firefox/158.0";
  const TypeErrorCtor = TypeError;
  const ErrorCtor = Error;
  const StringCtor = String;
  const URLCtor = typeof URL === "function" ? URL : null;
  const CustomEventCtor = typeof CustomEvent === "function"
    ? CustomEvent
    : (typeof window !== "undefined" && window && typeof window.CustomEvent === "function" ? window.CustomEvent : null);
  const isSecure = typeof isSecureContext === "boolean"
    ? isSecureContext
    : (typeof window !== "undefined" && window && typeof window.isSecureContext === "boolean" ? window.isSecureContext : true);
  const reflectApply = Reflect.apply;
  const callBind = Function.prototype.bind.bind(Function.prototype.call);
  const ObjectCreate = Object.create;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const defineProperty = Object.defineProperty;
  const getPrototypeOf = Object.getPrototypeOf;
  const isPrototypeOf = callBind(Object.prototype.isPrototypeOf);
  const hasOwn = callBind(Object.prototype.hasOwnProperty);
  const WeakSetCtor = typeof WeakSet === "function" ? WeakSet : null;
  const weakSetAdd = WeakSetCtor ? callBind(WeakSetCtor.prototype.add) : null;
  const weakSetHas = WeakSetCtor ? callBind(WeakSetCtor.prototype.has) : null;
  const strIndexOf = callBind(String.prototype.indexOf);
  const strStartsWith = callBind(String.prototype.startsWith);
  const strSlice = callBind(String.prototype.slice);
  const strTrim = callBind(String.prototype.trim);
  const strToLowerCase = callBind(String.prototype.toLowerCase);
  const strCharCodeAt = callBind(String.prototype.charCodeAt);
  const arrIsArray = Array.isArray;
  const arrPush = callBind(Array.prototype.push);
  const promiseResolve = Promise.resolve.bind(Promise);
  const promiseReject = Promise.reject.bind(Promise);
  const SymbolIterator = typeof Symbol === "function" && Symbol.iterator;
  const SymbolToStringTag = typeof Symbol === "function" && Symbol.toStringTag;
  const CustomEventProto = CustomEventCtor ? CustomEventCtor.prototype : null;
  const EventProto = (typeof Event === "function" && Event.prototype) || CustomEventProto;
  const stopImmediatePropFn = EventProto && typeof EventProto.stopImmediatePropagation === "function"
    ? callBind(EventProto.stopImmediatePropagation)
    : null;
  const preventDefaultFn = EventProto && typeof EventProto.preventDefault === "function"
    ? callBind(EventProto.preventDefault)
    : null;
  const eventDetailDesc = CustomEventProto ? getOwnPropertyDescriptor(CustomEventProto, "detail") : null;
  const eventDetailGet = eventDetailDesc && typeof eventDetailDesc.get === "function"
    ? callBind(eventDetailDesc.get)
    : null;
  const addWinListener = typeof window !== "undefined" && window && typeof window.addEventListener === "function"
    ? callBind(window.addEventListener)
    : null;
  const removeWinListener = typeof window !== "undefined" && window && typeof window.removeEventListener === "function"
    ? callBind(window.removeEventListener)
    : function () {};
  const dispatchWinEvent = typeof window !== "undefined" && window && typeof window.dispatchEvent === "function"
    ? callBind(window.dispatchEvent)
    : null;
  /*  */
  const stopEvent = function (event) {
    if (!event) return;
    if (stopImmediatePropFn) {
      try {
        stopImmediatePropFn(event);
        return;
      } catch (e) {}
    }
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  };
  /*  */
  const preventEvent = function (event) {
    if (!event) return;
    if (preventDefaultFn) {
      try {
        preventDefaultFn(event);
        return;
      } catch (e) {}
    }
    if (typeof event.preventDefault === "function") event.preventDefault();
  };
  /*  */
  const getEventDetail = function (event) {
    if (!event) return undefined;
    if (eventDetailGet) {
      try {
        return eventDetailGet(event);
      } catch (e) {
        return undefined;
      }
    }
    return event.detail;
  };
  /*  */
  const defineName = function (fn, name) {
    defineProperty(fn, "name", {"value": name, "configurable": true});
    return fn;
  };
  /*  */
  const rawProto = getPrototypeOf(navigator);
  const navProto = (typeof Navigator === "function" && Navigator.prototype) ||
    (rawProto && rawProto !== Object.prototype ? rawProto : navigator);
  /*  */
  const coreNavKeys = ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints"];
  const allNavKeys = ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints", "oscpu", "userAgentData"];
  const descriptors = ObjectCreate(null);
  const ownDescriptors = ObjectCreate(null);
  allNavKeys.forEach(function (key) {
    descriptors[key] = getOwnPropertyDescriptor(navProto, key);
    if (navProto !== navigator) {
      ownDescriptors[key] = getOwnPropertyDescriptor(navigator, key);
    }
  });
  /*  */
  const hadOscpu = "oscpu" in navigator;
  const original = {
    "userAgent": navigator.userAgent,
    "appVersion": navigator.appVersion,
    "platform": navigator.platform,
    "vendor": navigator.vendor,
    "maxTouchPoints": navigator.maxTouchPoints,
    "oscpu": hadOscpu ? navigator.oscpu : undefined
  };
  /*  */
  const NativeUADataCtor = typeof NavigatorUAData === "function" ? NavigatorUAData : null;
  const uaDataProto = NativeUADataCtor && NativeUADataCtor.prototype ? NativeUADataCtor.prototype : null;
  const uaDataKeys = ["brands", "mobile", "platform", "toJSON", "getHighEntropyValues"];
  const uaDataProtoDescriptors = ObjectCreate(null);
  if (uaDataProto) {
    uaDataKeys.forEach(function (key) {
      uaDataProtoDescriptors[key] = getOwnPropertyDescriptor(uaDataProto, key);
    });
  }
  const origUADataDesc = descriptors.userAgentData;
  const origUADataGet = origUADataDesc && typeof origUADataDesc.get === "function" ? origUADataDesc.get : null;
  let hasNativeUAData = false;
  if (uaDataProto && origUADataGet) {
    try {
      const nativeUADataSample = reflectApply(origUADataGet, navigator, []);
      hasNativeUAData = Boolean(nativeUADataSample && isPrototypeOf(uaDataProto, nativeUADataSample));
    } catch (e) {}
  }
  /*  */
  let activeUA = null;
  let cachedUA = null;
  let cachedValues = null;
  let isSpoofing = false;
  let navUADataModified = false;
  let uaDataWrapped = false;
  let lastSpoofUAData = null;
  /*  */
  const sanitizePrintableAscii = function (s) {
    if (typeof s !== "string") return null;
    const t = strTrim(s);
    if (!t) return null;
    for (let i = 0; i < t.length; i += 1) {
      const code = strCharCodeAt(t, i);
      if (code < 0x20 || code > 0x7e) return null;
    }
    return t;
  };
  /*  */
  const stripTrailingDots = function (s) {
    let end = s.length;
    while (end > 0 && strSlice(s, end - 1, end) === ".") {
      end -= 1;
    }
    return strSlice(s, 0, end);
  };
  /*  */
  const replaceChar = function (s, fromCh, toCh) {
    let out = "";
    for (let i = 0; i < s.length; i += 1) {
      const ch = strSlice(s, i, i + 1);
      out += ch === fromCh ? toCh : ch;
    }
    return out;
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
    if (!ver) return "";
    let end = 0;
    while (end < ver.length) {
      const ch = strSlice(ver, end, end + 1);
      if (ch < "0" || ch > "9") break;
      end += 1;
    }
    return strSlice(ver, 0, end);
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
  const isLowerAscii = function (code) {
    return code >= 0x61 && code <= 0x7a;
  };
  /*  */
  const isAsciiAlnum = function (code) {
    return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  };
  /*  */
  const isLocaleToken = function (token) {
    const len = token.length;
    if (len < 2 || len > 7) return false;
    let sepIdx = -1;
    for (let i = 0; i < len; i += 1) {
      const ch = strSlice(token, i, i + 1);
      if (ch === "-" || ch === "_") {
        sepIdx = i;
        break;
      }
    }
    const langEnd = sepIdx === -1 ? len : sepIdx;
    if (langEnd !== 2 && langEnd !== 3) return false;
    for (let i = 0; i < langEnd; i += 1) {
      if (!isLowerAscii(strCharCodeAt(token, i))) return false;
    }
    if (sepIdx === -1) return true;
    const regionLen = len - sepIdx - 1;
    if (regionLen !== 2 && regionLen !== 3) return false;
    for (let i = sepIdx + 1; i < len; i += 1) {
      if (!isAsciiAlnum(strCharCodeAt(token, i))) return false;
    }
    return true;
  };
  /*  */
  const extractAndroidModel = function (useragent, androidStart) {
    const start = androidStart + 8;
    let cursor = strIndexOf(useragent, ";", start);
    const close = strIndexOf(useragent, ")", start);
    if (cursor === -1 || (close !== -1 && close < cursor)) return "";
    const limit = close !== -1 ? close : useragent.length;
    cursor += 1;
    while (cursor <= limit) {
      const nextSemi = strIndexOf(useragent, ";", cursor);
      const tokenEnd = nextSemi !== -1 && nextSemi < limit ? nextSemi : limit;
      let token = strSlice(useragent, cursor, tokenEnd);
      const bIdx = strIndexOf(token, " Build/");
      if (bIdx !== -1) token = strSlice(token, 0, bIdx);
      token = strTrim(token);
      if (token && token !== "U" && token !== "wv" && token !== "Mobile" && token !== "Tablet" && !isLocaleToken(token)) {
        return token;
      }
      if (tokenEnd === limit) break;
      cursor = tokenEnd + 1;
    }
    return "";
  };
  /*  */
  const readHintsSequence = function (hints) {
    if (hints === null || hints === undefined || typeof hints !== "object") {
      throw new TypeErrorCtor("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': The provided value cannot be converted to a sequence.");
    }
    if (!SymbolIterator) {
      if (!arrIsArray(hints)) {
        throw new TypeErrorCtor("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': The provided value cannot be converted to a sequence.");
      }
      const list = [];
      for (let i = 0; i < hints.length; i += 1) {
        arrPush(list, StringCtor(hints[i]));
      }
      return list;
    }
    const iterMethod = hints[SymbolIterator];
    if (typeof iterMethod !== "function") {
      throw new TypeErrorCtor("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': The provided value cannot be converted to a sequence.");
    }
    const iterator = reflectApply(iterMethod, hints, []);
    if (!iterator || typeof iterator !== "object" || typeof iterator.next !== "function") {
      throw new TypeErrorCtor("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': The provided value cannot be converted to a sequence.");
    }
    const list = [];
    const nextFn = iterator.next;
    while (true) {
      const step = reflectApply(nextFn, iterator, []);
      if (!step || typeof step !== "object") {
        throw new TypeErrorCtor("Failed to execute 'getHighEntropyValues' on 'NavigatorUAData': Iterator result is not an object.");
      }
      if (step.done) break;
      arrPush(list, StringCtor(step.value));
    }
    return list;
  };
  /*  */
  const buildUAData = function (useragent, android, ios, isWindows, isMac, isCrOS, isLinux, hasIPad, hasIPhone, hasIPod) {
    const chromeFull = extractTokenAfter(useragent, "Chrome/") ||
      extractTokenAfter(useragent, "Chromium/") ||
      extractTokenAfter(fallback, "Chrome/") ||
      "157.0.0.0";
    const chromeMajor = majorOf(chromeFull) || "157";
    const edgeFull = extractTokenAfter(useragent, "EdgA/") || extractTokenAfter(useragent, "Edg/");
    const oprFull = extractTokenAfter(useragent, "OPR/");
    const samsungFull = extractTokenAfter(useragent, "SamsungBrowser/");
    const isWebView = strIndexOf(useragent, "; wv)") !== -1 || strIndexOf(useragent, "; wv;") !== -1;
    const hasChrome = strIndexOf(useragent, "Chrome/") !== -1;

    let brandName = null;
    let brandFull = chromeFull;
    if (strIndexOf(useragent, "EdgA/") !== -1 || strIndexOf(useragent, "Edg/") !== -1) {
      brandName = "Microsoft Edge";
      brandFull = edgeFull || chromeFull;
    } else if (strIndexOf(useragent, "OPR/") !== -1) {
      brandName = "Opera";
      brandFull = oprFull || chromeFull;
    } else if (strIndexOf(useragent, "SamsungBrowser/") !== -1) {
      brandName = "Samsung Internet";
      brandFull = samsungFull || chromeFull;
    } else if (isWebView) {
      brandName = "Android WebView";
      brandFull = chromeFull;
    } else if (hasChrome) {
      brandName = "Google Chrome";
      brandFull = chromeFull;
    }
    const brandMajor = majorOf(brandFull) || chromeMajor;
    const uaMobile = strIndexOf(useragent, "Mobile") !== -1 || hasIPhone || hasIPod;
    const uaPlatform = android ? "Android"
      : (ios ? "iOS"
        : (isWindows ? "Windows"
          : (isMac ? "macOS"
            : (isCrOS ? "Chrome OS"
              : (isLinux ? "Linux" : "Android")))));
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
    } else if (isWindows) {
      const winVer = extractTokenAfter(useragent, "Windows NT ");
      if (winVer) uaPlatformVersion = padPlatformVersion(winVer);
    } else if (isMac) {
      const macVer = extractTokenAfter(useragent, "Mac OS X ");
      if (macVer) uaPlatformVersion = padPlatformVersion(replaceChar(macVer, "_", "."));
    }

    const uaWow64 = strIndexOf(useragent, "WOW64") !== -1;
    let uaArchitecture = "";
    let uaBitness = "";
    if (!android && !ios) {
      if (strIndexOf(useragent, "arm64") !== -1 || strIndexOf(useragent, "aarch64") !== -1 || strIndexOf(useragent, "ARM64") !== -1) {
        uaArchitecture = "arm";
        uaBitness = "64";
      } else if (isWindows || isMac || isCrOS || isLinux) {
        uaArchitecture = "x86";
        uaBitness = (strIndexOf(useragent, "Win64") !== -1 || strIndexOf(useragent, "x64") !== -1 || strIndexOf(useragent, "x86_64") !== -1 || strIndexOf(useragent, "amd64") !== -1 || isMac)
          ? "64"
          : (uaWow64 ? "32" : "");
      }
    }
    const uaFormFactors = uaMobile ? ["Mobile"] : (android || hasIPad ? ["Tablet"] : ["Desktop"]);

    const makeBrands = function () {
      const list = [
        {"brand": "Not/A)Brand", "version": "8"},
        {"brand": "Chromium", "version": chromeMajor}
      ];
      if (brandName) arrPush(list, {"brand": brandName, "version": brandMajor});
      return list;
    };
    const makeFullVersionList = function () {
      const list = [
        {"brand": "Not/A)Brand", "version": "8.0.0.0"},
        {"brand": "Chromium", "version": chromeFull}
      ];
      if (brandName) arrPush(list, {"brand": brandName, "version": brandFull});
      return list;
    };

    const data = {
      "brands": makeBrands,
      "mobile": uaMobile,
      "platform": uaPlatform,
      "toJSON": function () {
        return {"brands": makeBrands(), "mobile": uaMobile, "platform": uaPlatform};
      },
      "getHighEntropyValues": function (hints) {
        let hintList;
        try {
          hintList = readHintsSequence(hints);
        } catch (err) {
          return promiseReject(err);
        }
        const out = {"brands": makeBrands(), "mobile": uaMobile, "platform": uaPlatform};
        for (let i = 0; i < hintList.length; i += 1) {
          const hint = hintList[i];
          if (hint === "architecture") out.architecture = uaArchitecture;
          else if (hint === "bitness") out.bitness = uaBitness;
          else if (hint === "formFactors") out.formFactors = [uaFormFactors[0]];
          else if (hint === "fullVersionList") out.fullVersionList = makeFullVersionList();
          else if (hint === "model") out.model = uaModel;
          else if (hint === "platformVersion") out.platformVersion = uaPlatformVersion;
          else if (hint === "uaFullVersion") out.uaFullVersion = brandFull;
          else if (hint === "wow64") out.wow64 = uaWow64;
        }
        return promiseResolve(out);
      }
    };
    lastSpoofUAData = data;
    return data;
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
    const isWindows = strIndexOf(useragent, "Windows") !== -1;
    const isMac = strIndexOf(useragent, "Macintosh") !== -1;
    const isCrOS = strIndexOf(useragent, "CrOS") !== -1;
    const isLinux = strIndexOf(useragent, "Linux") !== -1;
    const ipadDesktop = !ios && !android && !chrome && !firefox &&
      isMac && strIndexOf(useragent, "Safari/") !== -1;
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
    let computedOscpu = original.oscpu || "";
    if (android) {
      computedOscpu = "Linux armv8l";
    } else if (isWindows) {
      const winVer = extractTokenAfter(useragent, "Windows NT ");
      if (winVer) {
        if (strIndexOf(useragent, "Win64") !== -1 && strIndexOf(useragent, "x64") !== -1) {
          computedOscpu = "Windows NT " + winVer + "; Win64; x64";
        } else if (strIndexOf(useragent, "WOW64") !== -1) {
          computedOscpu = "Windows NT " + winVer + "; WOW64";
        } else if (strIndexOf(useragent, "Win64") !== -1) {
          computedOscpu = "Windows NT " + winVer + "; Win64";
        } else {
          computedOscpu = "Windows NT " + winVer;
        }
      }
    } else if (isMac) {
      const macVer = extractTokenAfter(useragent, "Mac OS X ");
      computedOscpu = macVer ? "Intel Mac OS X " + replaceChar(macVer, "_", ".") : "Intel Mac OS X";
    } else if (isCrOS || isLinux) {
      computedOscpu = "Linux x86_64";
    }
    /*  */
    const uaDataData = chrome
      ? buildUAData(useragent, android, ios, isWindows, isMac, isCrOS, isLinux, hasIPad, hasIPhone, hasIPod)
      : null;
    /*  */
    cachedUA = useragent;
    cachedValues = {
      "userAgent": useragent,
      "appVersion": appVersion,
      "platform": hasIPad ? "iPad"
        : (hasIPod ? "iPod"
          : (hasIPhone ? "iPhone"
            : (ipadDesktop ? "MacIntel"
              : (android ? "Linux armv8l"
                : (isWindows ? "Win32"
                  : (isMac ? "MacIntel"
                    : (isCrOS || isLinux ? "Linux x86_64" : original.platform))))))),
      "vendor": ios || ipadDesktop ? "Apple Computer, Inc." : (chrome ? "Google Inc." : (firefox ? "" : original.vendor)),
      "maxTouchPoints": ios || ipadDesktop || android ? 5 : original.maxTouchPoints,
      "oscpu": computedOscpu,
      "firefox": firefox,
      "chrome": chrome,
      "uaDataData": uaDataData
    };
    return cachedValues;
  };
  /*  */
  const origBrandGet = descriptors.userAgent && typeof descriptors.userAgent.get === "function"
    ? descriptors.userAgent.get
    : null;
  const checkBrand = function (self) {
    if (origBrandGet) {
      reflectApply(origBrandGet, self, []);
      return;
    }
    if (!self || (self !== navigator && (self === navProto || !isPrototypeOf(navProto, self)))) {
      throw new TypeErrorCtor("Illegal invocation");
    }
  };
  /*  */
  const makeGetter = function (key) {
    const origDesc = descriptors[key];
    const origGet = origDesc && typeof origDesc.get === "function" ? origDesc.get : null;
    return defineName(function () {
      let realValue;
      if (origGet) {
        realValue = reflectApply(origGet, this, []);
      } else {
        checkBrand(this);
        realValue = origDesc ? origDesc.value : original[key];
      }
      if (!activeUA) return realValue;
      return computeSpoof(activeUA)[key];
    }, "get " + key);
  };
  /*  */
  const coreGetters = ObjectCreate(null);
  coreNavKeys.forEach(function (key) {
    coreGetters[key] = makeGetter(key);
  });
  const oscpuGetter = makeGetter("oscpu");
  /*  */
  const spoofUADataInstances = WeakSetCtor ? new WeakSetCtor() : null;
  let spoofUADataSingleton = null;
  const SpoofUADataProto = ObjectCreate(uaDataProto || Object.prototype);
  if (SymbolToStringTag) {
    defineProperty(SpoofUADataProto, SymbolToStringTag, {
      "value": "NavigatorUAData",
      "configurable": true
    });
  }
  const checkSpoofUADataBrand = function (self) {
    if (!self || (spoofUADataInstances ? !weakSetHas(spoofUADataInstances, self) : self !== spoofUADataSingleton)) {
      throw new TypeErrorCtor("Illegal invocation");
    }
  };
  const getCurrentSpoofUAData = function () {
    if (activeUA) {
      const s = computeSpoof(activeUA);
      if (s.chrome && s.uaDataData) return s.uaDataData;
    }
    return lastSpoofUAData;
  };
  defineProperty(SpoofUADataProto, "brands", {
    "configurable": true,
    "enumerable": true,
    "get": defineName(function () {
      checkSpoofUADataBrand(this);
      const d = getCurrentSpoofUAData();
      return d ? d.brands() : [];
    }, "get brands")
  });
  defineProperty(SpoofUADataProto, "mobile", {
    "configurable": true,
    "enumerable": true,
    "get": defineName(function () {
      checkSpoofUADataBrand(this);
      const d = getCurrentSpoofUAData();
      return d ? d.mobile : false;
    }, "get mobile")
  });
  defineProperty(SpoofUADataProto, "platform", {
    "configurable": true,
    "enumerable": true,
    "get": defineName(function () {
      checkSpoofUADataBrand(this);
      const d = getCurrentSpoofUAData();
      return d ? d.platform : "";
    }, "get platform")
  });
  defineProperty(SpoofUADataProto, "toJSON", {
    "configurable": true,
    "enumerable": true,
    "writable": true,
    "value": defineName(function () {
      checkSpoofUADataBrand(this);
      const d = getCurrentSpoofUAData();
      return d ? d.toJSON() : {"brands": [], "mobile": false, "platform": ""};
    }, "toJSON")
  });
  defineProperty(SpoofUADataProto, "getHighEntropyValues", {
    "configurable": true,
    "enumerable": true,
    "writable": true,
    "value": defineName(function (hints) {
      try {
        checkSpoofUADataBrand(this);
      } catch (err) {
        return promiseReject(err);
      }
      const d = getCurrentSpoofUAData();
      return d ? d.getHighEntropyValues(hints) : promiseReject(new TypeErrorCtor("Illegal invocation"));
    }, "getHighEntropyValues")
  });
  const getSpoofUADataInstance = function () {
    if (!spoofUADataSingleton) {
      spoofUADataSingleton = ObjectCreate(SpoofUADataProto);
      if (spoofUADataInstances) weakSetAdd(spoofUADataInstances, spoofUADataSingleton);
    }
    return spoofUADataSingleton;
  };
  /*  */
  const uaDataGetter = defineName(function () {
    let realValue;
    if (origUADataGet) {
      realValue = reflectApply(origUADataGet, this, []);
    } else {
      checkBrand(this);
      realValue = origUADataDesc ? origUADataDesc.value : (ownDescriptors.userAgentData ? ownDescriptors.userAgentData.value : undefined);
    }
    if (!activeUA) return realValue;
    const spoofed = computeSpoof(activeUA);
    if (!spoofed.chrome || !isSecure) return undefined;
    return hasNativeUAData ? realValue : getSpoofUADataInstance();
  }, "get userAgentData");
  /*  */
  const installDescriptor = function (target, key, desc) {
    defineProperty(target, key, desc);
  };
  /*  */
  const restoreKey = function (key) {
    if (descriptors[key]) {
      installDescriptor(navProto, key, descriptors[key]);
    } else {
      delete navProto[key];
    }
    if (navProto !== navigator) {
      if (ownDescriptors[key]) {
        installDescriptor(navigator, key, ownDescriptors[key]);
      } else {
        delete navigator[key];
      }
    }
  };
  /*  */
  const wrapUADataProto = function () {
    if (!hasNativeUAData || uaDataWrapped) return;
    const origBrandsDesc = uaDataProtoDescriptors.brands;
    const origMobileDesc = uaDataProtoDescriptors.mobile;
    const origPlatformDesc = uaDataProtoDescriptors.platform;
    const origToJSONDesc = uaDataProtoDescriptors.toJSON;
    const origHighDesc = uaDataProtoDescriptors.getHighEntropyValues;
    /*  */
    const origBrandsGet = origBrandsDesc && origBrandsDesc.get;
    const origMobileGet = origMobileDesc && origMobileDesc.get;
    const origPlatformGet = origPlatformDesc && origPlatformDesc.get;
    const origToJSONFn = origToJSONDesc && origToJSONDesc.value;
    const origHighFn = origHighDesc && origHighDesc.value;
    const brandCheckGet = origMobileGet || origBrandsGet || origPlatformGet;
    /*  */
    const wrapGetter = function (key, origGet, readSpoof) {
      const desc = uaDataProtoDescriptors[key];
      return {
        "configurable": true,
        "enumerable": desc ? Boolean(desc.enumerable) : true,
        "get": defineName(function () {
          const real = typeof origGet === "function" ? reflectApply(origGet, this, []) : undefined;
          if (!activeUA) return real;
          const spoofed = computeSpoof(activeUA);
          if (!spoofed.chrome) return real;
          return readSpoof(spoofed.uaDataData);
        }, "get " + key)
      };
    };
    /*  */
    installDescriptor(uaDataProto, "brands", wrapGetter("brands", origBrandsGet, function (d) { return d.brands(); }));
    installDescriptor(uaDataProto, "mobile", wrapGetter("mobile", origMobileGet, function (d) { return d.mobile; }));
    installDescriptor(uaDataProto, "platform", wrapGetter("platform", origPlatformGet, function (d) { return d.platform; }));
    installDescriptor(uaDataProto, "toJSON", {
      "configurable": true,
      "enumerable": origToJSONDesc ? Boolean(origToJSONDesc.enumerable) : true,
      "writable": origToJSONDesc ? Boolean(origToJSONDesc.writable) : true,
      "value": defineName(function () {
        const real = typeof origToJSONFn === "function" ? reflectApply(origToJSONFn, this, []) : undefined;
        if (!activeUA) return real;
        const spoofed = computeSpoof(activeUA);
        if (!spoofed.chrome) return real;
        return spoofed.uaDataData.toJSON();
      }, "toJSON")
    });
    installDescriptor(uaDataProto, "getHighEntropyValues", {
      "configurable": true,
      "enumerable": origHighDesc ? Boolean(origHighDesc.enumerable) : true,
      "writable": origHighDesc ? Boolean(origHighDesc.writable) : true,
      "value": defineName(function (hints) {
        if (!activeUA) {
          return typeof origHighFn === "function"
            ? reflectApply(origHighFn, this, arguments)
            : promiseReject(new TypeErrorCtor("Illegal invocation"));
        }
        const spoofed = computeSpoof(activeUA);
        if (!spoofed.chrome) {
          return typeof origHighFn === "function"
            ? reflectApply(origHighFn, this, arguments)
            : promiseReject(new TypeErrorCtor("Illegal invocation"));
        }
        if (typeof brandCheckGet === "function") {
          try {
            reflectApply(brandCheckGet, this, []);
          } catch (err) {
            return promiseReject(err);
          }
        }
        return spoofed.uaDataData.getHighEntropyValues(hints);
      }, "getHighEntropyValues")
    });
    uaDataWrapped = true;
  };
  /*  */
  const restoreUADataProto = function () {
    if (!hasNativeUAData || !uaDataWrapped) return;
    for (let i = 0; i < uaDataKeys.length; i += 1) {
      const key = uaDataKeys[i];
      if (uaDataProtoDescriptors[key]) {
        installDescriptor(uaDataProto, key, uaDataProtoDescriptors[key]);
      } else {
        delete uaDataProto[key];
      }
    }
    uaDataWrapped = false;
  };
  /*  */
  const applyUA = function (nextUA) {
    activeUA = nextUA || null;
    if (!activeUA) {
      if (isSpoofing) {
        for (let i = 0; i < allNavKeys.length; i += 1) {
          restoreKey(allNavKeys[i]);
        }
        restoreUADataProto();
        navUADataModified = false;
        isSpoofing = false;
      }
      return;
    }
    /*  */
    if (!isSpoofing) {
      for (let i = 0; i < coreNavKeys.length; i += 1) {
        const key = coreNavKeys[i];
        installDescriptor(navProto, key, {
          "configurable": true,
          "enumerable": true,
          "get": coreGetters[key]
        });
        if (navProto !== navigator && hasOwn(navigator, key)) {
          delete navigator[key];
        }
      }
      isSpoofing = true;
    }
    /*  */
    const spoofed = computeSpoof(activeUA);
    if (spoofed.firefox) {
      installDescriptor(navProto, "oscpu", {"configurable": true, "enumerable": true, "get": oscpuGetter});
      if (navProto !== navigator && hasOwn(navigator, "oscpu")) delete navigator.oscpu;
    } else {
      delete navProto.oscpu;
      if (navProto !== navigator) delete navigator.oscpu;
    }
    if (spoofed.chrome && isSecure) {
      if (hasNativeUAData) {
        if (navUADataModified) {
          restoreKey("userAgentData");
          navUADataModified = false;
        }
        wrapUADataProto();
      } else {
        installDescriptor(navProto, "userAgentData", {"configurable": true, "enumerable": true, "get": uaDataGetter});
        if (navProto !== navigator && hasOwn(navigator, "userAgentData")) delete navigator.userAgentData;
        navUADataModified = true;
      }
    } else {
      restoreUADataProto();
      delete navProto.userAgentData;
      if (navProto !== navigator) delete navigator.userAgentData;
      navUADataModified = true;
    }
  };
  /*  */
  const readSession = function () {
    try {
      const raw = typeof sessionStorage !== "undefined" && sessionStorage ? sessionStorage.getItem("mobview-useragent") : null;
      return sanitizePrintableAscii(raw);
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
        return Boolean(locHost) && Boolean(URLCtor) &&
          stripTrailingDots(strToLowerCase(new URLCtor(topOrigin).hostname)) === locHost;
      } catch (e) {
        return false;
      }
    }
    return false;
  })();
  /*  */
  applyUA(canUseFallbackImmediately ? (readSession() || fallback) : null);
  /*  */
  if (addWinListener && dispatchWinEvent && CustomEventCtor) {
    const onChannel = function (event) {
      const ch = getEventDetail(event);
      if (typeof ch !== "string" || !ch) return;
      stopEvent(event);
      preventEvent(event);
      removeWinListener(window, "mobview-channel", onChannel, true);
      const onUA = function (uaEvent) {
        stopEvent(uaEvent);
        removeWinListener(window, ch, onUA, true);
        const detail = getEventDetail(uaEvent);
        if (typeof detail === "string") applyUA(sanitizePrintableAscii(detail));
      };
      addWinListener(window, ch, onUA, true);
    };
    addWinListener(window, "mobview-channel", onChannel, true);
    try {
      dispatchWinEvent(window, new CustomEventCtor("mobview-ready"));
    } catch (e) {}
  }
}
