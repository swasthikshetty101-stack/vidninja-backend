(function(global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports, require("cheerio"), require("nanoid"), require("unpacker"), require("crypto-js"), require("iso-639-1"), require("cookie"), require("set-cookie-parser"), require("hls-parser"), require("form-data")) : typeof define === "function" && define.amd ? define(["exports", "cheerio", "nanoid", "unpacker", "crypto-js", "iso-639-1", "cookie", "set-cookie-parser", "hls-parser", "form-data"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.index = {}, global.cheerio, global.nanoid, global.unpacker, global["crypto-js"], global["iso-639-1"], global.cookie, global["set-cookie-parser"], global["hls-parser"], global["form-data"]));
})(this, function(exports, cheerio, nanoid$1, unpacker, crypto, ISO6391, cookie, setCookieParser, hlsParser, FormData) {
  "use strict";var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  function _interopNamespaceDefault(e) {
    const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
    if (e) {
      for (const k in e) {
        if (k !== "default") {
          const d = Object.getOwnPropertyDescriptor(e, k);
          Object.defineProperty(n, k, d.get ? d : {
            enumerable: true,
            get: () => e[k]
          });
        }
      }
    }
    n.default = e;
    return Object.freeze(n);
  }
  const cheerio__namespace = /* @__PURE__ */ _interopNamespaceDefault(cheerio);
  const unpacker__namespace = /* @__PURE__ */ _interopNamespaceDefault(unpacker);
  class NotFoundError extends Error {
    constructor(reason) {
      super(`Couldn't find a stream: ${reason ?? "not found"}`);
      this.name = "NotFoundError";
    }
  }
  function formatSourceMeta(v) {
    const types = [];
    if (v.scrapeMovie) types.push("movie");
    if (v.scrapeShow) types.push("show");
    return {
      type: "source",
      id: v.id,
      rank: v.rank,
      name: v.name,
      mediaTypes: types
    };
  }
  function formatEmbedMeta(v) {
    return {
      type: "embed",
      id: v.id,
      rank: v.rank,
      name: v.name
    };
  }
  function getAllSourceMetaSorted(list) {
    return list.sources.sort((a, b) => b.rank - a.rank).map(formatSourceMeta);
  }
  function getAllEmbedMetaSorted(list) {
    return list.embeds.sort((a, b) => b.rank - a.rank).map(formatEmbedMeta);
  }
  function getSpecificId(list, id) {
    const foundSource = list.sources.find((v) => v.id === id);
    if (foundSource) {
      return formatSourceMeta(foundSource);
    }
    const foundEmbed = list.embeds.find((v) => v.id === id);
    if (foundEmbed) {
      return formatEmbedMeta(foundEmbed);
    }
    return null;
  }
  function makeFullUrl(url, ops) {
    let leftSide = (ops == null ? void 0 : ops.baseUrl) ?? "";
    let rightSide = url;
    if (leftSide.length > 0 && !leftSide.endsWith("/")) leftSide += "/";
    if (rightSide.startsWith("/")) rightSide = rightSide.slice(1);
    const fullUrl = leftSide + rightSide;
    if (!fullUrl.startsWith("http://") && !fullUrl.startsWith("https://") && !fullUrl.startsWith("data:"))
      throw new Error(`Invald URL -- URL doesn't start with a http scheme: '${fullUrl}'`);
    const parsedUrl = new URL(fullUrl);
    Object.entries((ops == null ? void 0 : ops.query) ?? {}).forEach(([k, v]) => {
      parsedUrl.searchParams.set(k, v);
    });
    return parsedUrl.toString();
  }
  function makeFetcher(fetcher) {
    const newFetcher = (url, ops) => {
      return fetcher(url, {
        headers: (ops == null ? void 0 : ops.headers) ?? {},
        method: (ops == null ? void 0 : ops.method) ?? "GET",
        query: (ops == null ? void 0 : ops.query) ?? {},
        baseUrl: (ops == null ? void 0 : ops.baseUrl) ?? "",
        readHeaders: (ops == null ? void 0 : ops.readHeaders) ?? [],
        body: ops == null ? void 0 : ops.body,
        credentials: ops == null ? void 0 : ops.credentials
      });
    };
    const output = async (url, ops) => (await newFetcher(url, ops)).body;
    output.full = newFetcher;
    return output;
  }
  const flags = {
    // CORS are set to allow any origin
    CORS_ALLOWED: "cors-allowed",
    // the stream is locked on IP, so only works if
    // request maker is same as player (not compatible with proxies)
    IP_LOCKED: "ip-locked",
    // The source/embed is blocking cloudflare ip's
    // This flag is not compatible with a proxy hosted on cloudflare
    CF_BLOCKED: "cf-blocked",
    // Streams and sources with this flag wont be proxied
    // And will be exclusive to the extension
    PROXY_BLOCKED: "proxy-blocked"
  };
  const targets = {
    // browser with CORS restrictions
    BROWSER: "browser",
    // browser, but no CORS restrictions through a browser extension
    BROWSER_EXTENSION: "browser-extension",
    // native app, so no restrictions in what can be played
    NATIVE: "native",
    // any target, no target restrictions
    ANY: "any"
  };
  const targetToFeatures = {
    browser: {
      requires: [flags.CORS_ALLOWED],
      disallowed: []
    },
    "browser-extension": {
      requires: [],
      disallowed: []
    },
    native: {
      requires: [],
      disallowed: []
    },
    any: {
      requires: [],
      disallowed: []
    }
  };
  function getTargetFeatures(target, consistentIpForRequests, proxyStreams) {
    const features = targetToFeatures[target];
    if (!consistentIpForRequests) features.disallowed.push(flags.IP_LOCKED);
    if (proxyStreams) features.disallowed.push(flags.PROXY_BLOCKED);
    return features;
  }
  function flagsAllowedInFeatures(features, inputFlags) {
    const hasAllFlags = features.requires.every((v) => inputFlags.includes(v));
    if (!hasAllFlags) return false;
    const hasDisallowedFlag = features.disallowed.some((v) => inputFlags.includes(v));
    if (hasDisallowedFlag) return false;
    return true;
  }
  let DEFAULT_PROXY_URL = "https://proxy.nsbx.ru/proxy";
  let CONFIGURED_M3U8_PROXY_URL = "https://proxy2.pstream.mov";
  function setProxyUrl(proxyUrl) {
    DEFAULT_PROXY_URL = proxyUrl;
  }
  function setM3U8ProxyUrl(proxyUrl) {
    CONFIGURED_M3U8_PROXY_URL = proxyUrl;
  }
  function getM3U8ProxyUrl() {
    return CONFIGURED_M3U8_PROXY_URL;
  }
  function requiresProxy(stream) {
    if (!stream.flags.includes(flags.CORS_ALLOWED) || !!(stream.headers && Object.keys(stream.headers).length > 0))
      return true;
    return false;
  }
  function setupProxy(stream) {
    const headers2 = stream.headers && Object.keys(stream.headers).length > 0 ? stream.headers : void 0;
    if (stream.type === "hls") {
      const encodedUrl = encodeURIComponent(stream.playlist);
      const encodedHeaders = headers2 ? encodeURIComponent(JSON.stringify(headers2)) : "";
      stream.playlist = `${CONFIGURED_M3U8_PROXY_URL}?url=${encodedUrl}${encodedHeaders ? `&headers=${encodedHeaders}` : ""}`;
    }
    if (stream.type === "file") {
      const payload = {
        type: "mp4",
        headers: headers2,
        options: {}
      };
      Object.entries(stream.qualities).forEach((entry) => {
        const filePayload = { ...payload, url: entry[1].url };
        entry[1].url = `${DEFAULT_PROXY_URL}?${new URLSearchParams({ payload: Buffer.from(JSON.stringify(filePayload)).toString("base64url") })}`;
      });
    }
    stream.headers = {};
    stream.flags = [flags.CORS_ALLOWED];
    return stream;
  }
  function createM3U8ProxyUrl(url, headers2 = {}) {
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(headers2));
    return `${CONFIGURED_M3U8_PROXY_URL}/m3u8-proxy?url=${encodedUrl}${headers2 ? `&headers=${encodedHeaders}` : ""}`;
  }
  function updateM3U8ProxyUrl(url) {
    if (url.includes("/m3u8-proxy?url=")) {
      return url.replace(/https:\/\/[^/]+\/m3u8-proxy/, `${CONFIGURED_M3U8_PROXY_URL}/m3u8-proxy`);
    }
    return url;
  }
  function makeSourcerer(state) {
    const mediaTypes = [];
    if (state.scrapeMovie) mediaTypes.push("movie");
    if (state.scrapeShow) mediaTypes.push("show");
    return {
      ...state,
      type: "source",
      disabled: state.disabled ?? false,
      externalSource: state.externalSource ?? false,
      mediaTypes
    };
  }
  function makeEmbed(state) {
    return {
      ...state,
      type: "embed",
      disabled: state.disabled ?? false,
      mediaTypes: void 0
    };
  }
  async function comboScraper$n(ctx2) {
    const embedPage = await ctx2.proxiedFetcher(
      `https://bombthe.irish/embed/${ctx2.media.type === "movie" ? `movie/${ctx2.media.tmdbId}` : `tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}`}`
    );
    const $2 = cheerio.load(embedPage);
    const embeds = [];
    $2("#dropdownMenu a").each((_, element) => {
      const url = new URL($2(element).data("url")).searchParams.get("url");
      if (!url) return;
      embeds.push({ embedId: $2(element).text().toLowerCase(), url: atob(url) });
    });
    return { embeds };
  }
  const bombtheirishScraper = makeSourcerer({
    id: "bombtheirish",
    name: "bombthe.irish",
    rank: 100,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$n,
    scrapeShow: comboScraper$n
  });
  const warezcdnBase = "https://embed.warezcdn.link";
  const warezcdnPlayerBase = "https://warezcdn.link/player";
  const warezcdnWorkerProxy = "https://workerproxy.warezcdn.workers.dev";
  function decrypt$1(input) {
    let output = atob(input);
    output = output.trim();
    output = output.split("").reverse().join("");
    let last = output.slice(-5);
    last = last.split("").reverse().join("");
    output = output.slice(0, -5);
    return `${output}${last}`;
  }
  async function getDecryptedId(ctx2) {
    var _a;
    const page = await ctx2.proxiedFetcher(`/player.php`, {
      baseUrl: warezcdnPlayerBase,
      headers: {
        Referer: `${warezcdnPlayerBase}/getEmbed.php?${new URLSearchParams({
          id: ctx2.url,
          sv: "warezcdn"
        })}`
      },
      query: {
        id: ctx2.url
      }
    });
    const allowanceKey = (_a = page.match(/let allowanceKey = "(.*?)";/)) == null ? void 0 : _a[1];
    if (!allowanceKey) throw new NotFoundError("Failed to get allowanceKey");
    const streamData = await ctx2.proxiedFetcher("/functions.php", {
      baseUrl: warezcdnPlayerBase,
      method: "POST",
      body: new URLSearchParams({
        getVideo: ctx2.url,
        key: allowanceKey
      })
    });
    const stream = JSON.parse(streamData);
    if (!stream.id) throw new NotFoundError("can't get stream id");
    const decryptedId = decrypt$1(stream.id);
    if (!decryptedId) throw new NotFoundError("can't get file id");
    return decryptedId;
  }
  const cdnListing = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64];
  async function checkUrls(ctx2, fileId) {
    for (const id of cdnListing) {
      const url = `https://cloclo${id}.cloud.mail.ru/weblink/view/${fileId}`;
      const response = await ctx2.proxiedFetcher.full(url, {
        method: "GET",
        headers: {
          Range: "bytes=0-1"
        }
      });
      if (response.statusCode === 206) return url;
    }
    return null;
  }
  const warezcdnembedMp4Scraper = makeEmbed({
    id: "warezcdnembedmp4",
    // WarezCDN is both a source and an embed host
    name: "WarezCDN MP4",
    // method no longer works
    rank: 82,
    disabled: true,
    async scrape(ctx2) {
      const decryptedId = await getDecryptedId(ctx2);
      if (!decryptedId) throw new NotFoundError("can't get file id");
      const streamUrl = await checkUrls(ctx2, decryptedId);
      if (!streamUrl) throw new NotFoundError("can't get stream id");
      return {
        stream: [
          {
            id: "primary",
            captions: [],
            qualities: {
              unknown: {
                type: "mp4",
                url: `${warezcdnWorkerProxy}/?${new URLSearchParams({
                  url: streamUrl
                })}`
              }
            },
            type: "file",
            flags: [flags.CORS_ALLOWED]
          }
        ]
      };
    }
  });
  const SKIP_VALIDATION_CHECK_IDS = [
    warezcdnembedMp4Scraper.id
    // deltaScraper.id,
    // alphaScraper.id,
    // novaScraper.id,
    // astraScraper.id,
    // orionScraper.id,
  ];
  const UNPROXIED_VALIDATION_CHECK_IDS = [
    // sources here are always proxied, so we dont need to validate with a proxy
    bombtheirishScraper.id
    // this one is dead, but i'll keep it here for now
  ];
  function isValidStream(stream) {
    if (!stream) return false;
    if (stream.type === "hls") {
      if (!stream.playlist) return false;
      return true;
    }
    if (stream.type === "file") {
      const validQualities = Object.values(stream.qualities).filter((v) => v.url.length > 0);
      if (validQualities.length === 0) return false;
      return true;
    }
    return false;
  }
  function isAlreadyProxyUrl(url) {
    return url.includes("/m3u8-proxy?url=");
  }
  async function validatePlayableStream(stream, ops, sourcererId) {
    if (SKIP_VALIDATION_CHECK_IDS.includes(sourcererId)) return stream;
    const alwaysUseNormalFetch = UNPROXIED_VALIDATION_CHECK_IDS.includes(sourcererId);
    if (stream.type === "hls") {
      if (stream.playlist.startsWith("data:")) return stream;
      const useNormalFetch = alwaysUseNormalFetch || isAlreadyProxyUrl(stream.playlist);
      let result;
      if (useNormalFetch) {
        try {
          const response = await fetch(stream.playlist, {
            method: "GET",
            headers: {
              ...stream.preferredHeaders,
              ...stream.headers
            }
          });
          result = {
            statusCode: response.status,
            body: await response.text(),
            finalUrl: response.url
          };
        } catch (error) {
          return null;
        }
      } else {
        result = await ops.proxiedFetcher.full(stream.playlist, {
          method: "GET",
          headers: {
            ...stream.preferredHeaders,
            ...stream.headers
          }
        });
      }
      if (result.statusCode < 200 || result.statusCode >= 400) return null;
      return stream;
    }
    if (stream.type === "file") {
      const validQualitiesResults = await Promise.all(
        Object.values(stream.qualities).map(async (quality) => {
          const useNormalFetch = alwaysUseNormalFetch || isAlreadyProxyUrl(quality.url);
          if (useNormalFetch) {
            try {
              const response = await fetch(quality.url, {
                method: "GET",
                headers: {
                  ...stream.preferredHeaders,
                  ...stream.headers,
                  Range: "bytes=0-1"
                }
              });
              return {
                statusCode: response.status,
                body: await response.text(),
                finalUrl: response.url
              };
            } catch (error) {
              return { statusCode: 500, body: "", finalUrl: quality.url };
            }
          }
          return ops.proxiedFetcher.full(quality.url, {
            method: "GET",
            headers: {
              ...stream.preferredHeaders,
              ...stream.headers,
              Range: "bytes=0-1"
            }
          });
        })
      );
      const validQualities = stream.qualities;
      Object.keys(stream.qualities).forEach((quality, index) => {
        if (validQualitiesResults[index].statusCode < 200 || validQualitiesResults[index].statusCode >= 400) {
          delete validQualities[quality];
        }
      });
      if (Object.keys(validQualities).length === 0) return null;
      return { ...stream, qualities: validQualities };
    }
    return null;
  }
  async function validatePlayableStreams(streams, ops, sourcererId) {
    if (SKIP_VALIDATION_CHECK_IDS.includes(sourcererId)) return streams;
    return (await Promise.all(streams.map((stream) => validatePlayableStream(stream, ops, sourcererId)))).filter(
      (v) => v !== null
    );
  }
  async function scrapeInvidualSource(list, ops) {
    const sourceScraper = list.sources.find((v) => ops.id === v.id);
    if (!sourceScraper) throw new Error("Source with ID not found");
    if (ops.media.type === "movie" && !sourceScraper.scrapeMovie) throw new Error("Source is not compatible with movies");
    if (ops.media.type === "show" && !sourceScraper.scrapeShow) throw new Error("Source is not compatible with shows");
    const contextBase = {
      fetcher: ops.fetcher,
      proxiedFetcher: ops.proxiedFetcher,
      progress(val) {
        var _a, _b;
        (_b = (_a = ops.events) == null ? void 0 : _a.update) == null ? void 0 : _b.call(_a, {
          id: sourceScraper.id,
          percentage: val,
          status: "pending"
        });
      }
    };
    let output = null;
    if (ops.media.type === "movie" && sourceScraper.scrapeMovie)
      output = await sourceScraper.scrapeMovie({
        ...contextBase,
        media: ops.media
      });
    else if (ops.media.type === "show" && sourceScraper.scrapeShow)
      output = await sourceScraper.scrapeShow({
        ...contextBase,
        media: ops.media
      });
    if (output == null ? void 0 : output.stream) {
      output.stream = output.stream.filter((stream) => isValidStream(stream)).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
      output.stream = output.stream.map(
        (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
      );
    }
    if (!output) throw new Error("output is null");
    output.embeds = output.embeds.filter((embed2) => {
      const e = list.embeds.find((v) => v.id === embed2.embedId);
      if (!e || e.disabled) return false;
      return true;
    });
    if ((!output.stream || output.stream.length === 0) && output.embeds.length === 0)
      throw new NotFoundError("No streams found");
    if (output.stream && output.stream.length > 0 && output.embeds.length === 0) {
      const playableStreams = await validatePlayableStreams(output.stream, ops, sourceScraper.id);
      if (playableStreams.length === 0) throw new NotFoundError("No playable streams found");
      output.stream = playableStreams;
    }
    return output;
  }
  async function scrapeIndividualEmbed(list, ops) {
    const embedScraper = list.embeds.find((v) => ops.id === v.id);
    if (!embedScraper) throw new Error("Embed with ID not found");
    const url = ops.url;
    const output = await embedScraper.scrape({
      fetcher: ops.fetcher,
      proxiedFetcher: ops.proxiedFetcher,
      url,
      progress(val) {
        var _a, _b;
        (_b = (_a = ops.events) == null ? void 0 : _a.update) == null ? void 0 : _b.call(_a, {
          id: embedScraper.id,
          percentage: val,
          status: "pending"
        });
      }
    });
    output.stream = output.stream.filter((stream) => isValidStream(stream)).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
    if (output.stream.length === 0) throw new NotFoundError("No streams found");
    output.stream = output.stream.map(
      (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
    );
    const playableStreams = await validatePlayableStreams(output.stream, ops, embedScraper.id);
    if (playableStreams.length === 0) throw new NotFoundError("No playable streams found");
    output.stream = playableStreams;
    return output;
  }
  function reorderOnIdList(order, list) {
    const copy = [...list];
    copy.sort((a, b) => {
      const aIndex = order.indexOf(a.id);
      const bIndex = order.indexOf(b.id);
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
      if (bIndex >= 0) return 1;
      if (aIndex >= 0) return -1;
      return b.rank - a.rank;
    });
    return copy;
  }
  async function runAllProviders(list, ops) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    const sources = reorderOnIdList(ops.sourceOrder ?? [], list.sources).filter((source) => {
      if (ops.media.type === "movie") return !!source.scrapeMovie;
      if (ops.media.type === "show") return !!source.scrapeShow;
      return false;
    });
    const embeds = reorderOnIdList(ops.embedOrder ?? [], list.embeds);
    const embedIds = embeds.map((embed2) => embed2.id);
    let lastId = "";
    const contextBase = {
      fetcher: ops.fetcher,
      proxiedFetcher: ops.proxiedFetcher,
      progress(val) {
        var _a2, _b2;
        (_b2 = (_a2 = ops.events) == null ? void 0 : _a2.update) == null ? void 0 : _b2.call(_a2, {
          id: lastId,
          percentage: val,
          status: "pending"
        });
      }
    };
    (_b = (_a = ops.events) == null ? void 0 : _a.init) == null ? void 0 : _b.call(_a, {
      sourceIds: sources.map((v) => v.id)
    });
    for (const source of sources) {
      (_d = (_c = ops.events) == null ? void 0 : _c.start) == null ? void 0 : _d.call(_c, source.id);
      lastId = source.id;
      let output = null;
      try {
        if (ops.media.type === "movie" && source.scrapeMovie)
          output = await source.scrapeMovie({
            ...contextBase,
            media: ops.media
          });
        else if (ops.media.type === "show" && source.scrapeShow)
          output = await source.scrapeShow({
            ...contextBase,
            media: ops.media
          });
        if (output) {
          output.stream = (output.stream ?? []).filter(isValidStream).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
          output.stream = output.stream.map(
            (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
          );
        }
        if (!output || !((_e = output.stream) == null ? void 0 : _e.length) && !output.embeds.length) {
          throw new NotFoundError("No streams found");
        }
      } catch (error) {
        const updateParams = {
          id: source.id,
          percentage: 100,
          status: error instanceof NotFoundError ? "notfound" : "failure",
          reason: error instanceof NotFoundError ? error.message : void 0,
          error: error instanceof NotFoundError ? void 0 : error
        };
        (_g = (_f = ops.events) == null ? void 0 : _f.update) == null ? void 0 : _g.call(_f, updateParams);
        continue;
      }
      if (!output) throw new Error("Invalid media type");
      if ((_h = output.stream) == null ? void 0 : _h[0]) {
        const playableStream = await validatePlayableStream(output.stream[0], ops, source.id);
        if (!playableStream) throw new NotFoundError("No streams found");
        return {
          sourceId: source.id,
          stream: playableStream
        };
      }
      const sortedEmbeds = output.embeds.filter((embed2) => {
        const e = list.embeds.find((v) => v.id === embed2.embedId);
        return e && !e.disabled;
      }).sort((a, b) => embedIds.indexOf(a.embedId) - embedIds.indexOf(b.embedId));
      if (sortedEmbeds.length > 0) {
        (_j = (_i = ops.events) == null ? void 0 : _i.discoverEmbeds) == null ? void 0 : _j.call(_i, {
          embeds: sortedEmbeds.map((embed2, i) => ({
            id: [source.id, i].join("-"),
            embedScraperId: embed2.embedId
          })),
          sourceId: source.id
        });
      }
      for (const [ind, embed2] of sortedEmbeds.entries()) {
        const scraper = embeds.find((v) => v.id === embed2.embedId);
        if (!scraper) throw new Error("Invalid embed returned");
        const id = [source.id, ind].join("-");
        (_l = (_k = ops.events) == null ? void 0 : _k.start) == null ? void 0 : _l.call(_k, id);
        lastId = id;
        let embedOutput;
        try {
          embedOutput = await scraper.scrape({
            ...contextBase,
            url: embed2.url
          });
          embedOutput.stream = embedOutput.stream.filter(isValidStream).filter((stream) => flagsAllowedInFeatures(ops.features, stream.flags));
          embedOutput.stream = embedOutput.stream.map(
            (stream) => requiresProxy(stream) && ops.proxyStreams ? setupProxy(stream) : stream
          );
          if (embedOutput.stream.length === 0) {
            throw new NotFoundError("No streams found");
          }
          const playableStream = await validatePlayableStream(embedOutput.stream[0], ops, embed2.embedId);
          if (!playableStream) throw new NotFoundError("No streams found");
          embedOutput.stream = [playableStream];
        } catch (error) {
          const updateParams = {
            id,
            percentage: 100,
            status: error instanceof NotFoundError ? "notfound" : "failure",
            reason: error instanceof NotFoundError ? error.message : void 0,
            error: error instanceof NotFoundError ? void 0 : error
          };
          (_n = (_m = ops.events) == null ? void 0 : _m.update) == null ? void 0 : _n.call(_m, updateParams);
          continue;
        }
        return {
          sourceId: source.id,
          embedId: scraper.id,
          stream: embedOutput.stream[0]
        };
      }
    }
    return null;
  }
  function makeControls(ops) {
    const list = {
      embeds: ops.embeds,
      sources: ops.sources
    };
    const providerRunnerOps = {
      features: ops.features,
      fetcher: makeFetcher(ops.fetcher),
      proxiedFetcher: makeFetcher(ops.proxiedFetcher ?? ops.fetcher),
      proxyStreams: ops.proxyStreams
    };
    return {
      runAll(runnerOps) {
        return runAllProviders(list, {
          ...providerRunnerOps,
          ...runnerOps
        });
      },
      runSourceScraper(runnerOps) {
        return scrapeInvidualSource(list, {
          ...providerRunnerOps,
          ...runnerOps
        });
      },
      runEmbedScraper(runnerOps) {
        return scrapeIndividualEmbed(list, {
          ...providerRunnerOps,
          ...runnerOps
        });
      },
      getMetadata(id) {
        return getSpecificId(list, id);
      },
      listSources() {
        return getAllSourceMetaSorted(list);
      },
      listEmbeds() {
        return getAllEmbedMetaSorted(list);
      }
    };
  }
  const nanoid = nanoid$1.customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 10);
  const baseUrl$l = "https://d000d.com";
  const doodScraper = makeEmbed({
    id: "dood",
    name: "dood",
    rank: 173,
    async scrape(ctx2) {
      var _a, _b;
      let url = ctx2.url;
      if (ctx2.url.includes("primewire")) {
        const request = await ctx2.proxiedFetcher.full(ctx2.url);
        url = request.finalUrl;
      }
      const id = url.split("/d/")[1] || url.split("/e/")[1];
      const doodData = await ctx2.proxiedFetcher(`/e/${id}`, {
        method: "GET",
        baseUrl: baseUrl$l
      });
      const dataForLater = (_a = doodData.match(/\?token=([^&]+)&expiry=/)) == null ? void 0 : _a[1];
      const path = (_b = doodData.match(/\$\.get\('\/pass_md5([^']+)/)) == null ? void 0 : _b[1];
      const thumbnailTrack = doodData.match(/thumbnails:\s\{\s*vtt:\s'([^']*)'/);
      const doodPage = await ctx2.proxiedFetcher(`/pass_md5${path}`, {
        headers: {
          Referer: `${baseUrl$l}/e/${id}`
        },
        method: "GET",
        baseUrl: baseUrl$l
      });
      const downloadURL = `${doodPage}${nanoid()}?token=${dataForLater}&expiry=${Date.now()}`;
      if (!downloadURL.startsWith("http")) throw new Error("Invalid URL");
      return {
        stream: [
          {
            id: "primary",
            type: "file",
            flags: [],
            captions: [],
            qualities: {
              unknown: {
                type: "mp4",
                url: downloadURL
              }
            },
            headers: {
              Referer: baseUrl$l
            },
            ...thumbnailTrack ? {
              thumbnailTrack: {
                type: "vtt",
                url: `https:${thumbnailTrack[1]}`
              }
            } : {}
          }
        ]
      };
    }
  });
  const mixdropBase = "https://mixdrop.ag";
  const packedRegex$1 = /(eval\(function\(p,a,c,k,e,d\){.*{}\)\))/;
  const linkRegex$1 = /MDCore\.wurl="(.*?)";/;
  const mixdropScraper = makeEmbed({
    id: "mixdrop",
    name: "MixDrop",
    rank: 198,
    async scrape(ctx2) {
      let embedUrl = ctx2.url;
      if (ctx2.url.includes("primewire")) embedUrl = (await ctx2.fetcher.full(ctx2.url)).finalUrl;
      const embedId = new URL(embedUrl).pathname.split("/")[2];
      const streamRes = await ctx2.proxiedFetcher(`/e/${embedId}`, {
        baseUrl: mixdropBase
      });
      const packed = streamRes.match(packedRegex$1);
      if (!packed) {
        throw new Error("failed to find packed mixdrop JavaScript");
      }
      const unpacked = unpacker__namespace.unpack(packed[1]);
      const link = unpacked.match(linkRegex$1);
      if (!link) {
        throw new Error("failed to find packed mixdrop source link");
      }
      const url = link[1];
      return {
        stream: [
          {
            id: "primary",
            type: "file",
            flags: [flags.IP_LOCKED],
            captions: [],
            qualities: {
              unknown: {
                type: "mp4",
                url: url.startsWith("http") ? url : `https:${url}`,
                // URLs don't always start with the protocol
                headers: {
                  // MixDrop requires this header on all streams
                  Referer: mixdropBase
                }
              }
            }
          }
        ]
      };
    }
  });
  function hexToChar(hex) {
    return String.fromCharCode(parseInt(hex, 16));
  }
  function decrypt(data, key) {
    var _a;
    const formatedData = ((_a = data.match(/../g)) == null ? void 0 : _a.map(hexToChar).join("")) || "";
    return formatedData.split("").map((char, i) => String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join("");
  }
  const turbovidScraper = makeEmbed({
    id: "turbovid",
    name: "Turbovid",
    rank: 122,
    async scrape(ctx2) {
      var _a, _b;
      const baseUrl3 = new URL(ctx2.url).origin;
      const embedPage = await ctx2.proxiedFetcher(ctx2.url);
      ctx2.progress(30);
      const apkey = (_a = embedPage.match(/const\s+apkey\s*=\s*"(.*?)";/)) == null ? void 0 : _a[1];
      const xxid = (_b = embedPage.match(/const\s+xxid\s*=\s*"(.*?)";/)) == null ? void 0 : _b[1];
      if (!apkey || !xxid) throw new Error("Failed to get required values");
      const encodedJuiceKey = JSON.parse(
        await ctx2.proxiedFetcher("/api/cucked/juice_key", {
          baseUrl: baseUrl3,
          headers: {
            referer: ctx2.url,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            Connection: "keep-alive",
            "Content-Type": "application/json",
            "X-Turbo": "TurboVidClient",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
          }
        })
      ).juice;
      if (!encodedJuiceKey) throw new Error("Failed to fetch the key");
      const juiceKey = atob(encodedJuiceKey);
      ctx2.progress(60);
      const data = JSON.parse(
        await ctx2.proxiedFetcher("/api/cucked/the_juice_v2/", {
          baseUrl: baseUrl3,
          query: {
            [apkey]: xxid
          },
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            Connection: "keep-alive",
            "Content-Type": "application/json",
            "X-Turbo": "TurboVidClient",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            referer: ctx2.url
          }
        })
      ).data;
      if (!data) throw new Error("Failed to fetch required data");
      ctx2.progress(90);
      const playlist = decrypt(data, juiceKey);
      const streamHeaders = {
        referer: `${baseUrl3}/`,
        origin: baseUrl3
      };
      return {
        stream: [
          {
            type: "hls",
            id: "primary",
            playlist: createM3U8ProxyUrl(playlist, streamHeaders),
            flags: [],
            captions: []
          }
        ]
      };
    }
  });
  const captionTypes = {
    srt: "srt",
    vtt: "vtt"
  };
  function getCaptionTypeFromUrl(url) {
    const extensions = Object.keys(captionTypes);
    const type = extensions.find((v) => url.endsWith(`.${v}`));
    if (!type) return null;
    return type;
  }
  function labelToLanguageCode(label) {
    const languageMap = {
      "chinese - hong kong": "zh",
      "chinese - traditional": "zh",
      czech: "cs",
      danish: "da",
      dutch: "nl",
      english: "en",
      "english - sdh": "en",
      finnish: "fi",
      french: "fr",
      german: "de",
      greek: "el",
      hungarian: "hu",
      italian: "it",
      korean: "ko",
      norwegian: "no",
      polish: "pl",
      portuguese: "pt",
      "portuguese - brazilian": "pt",
      romanian: "ro",
      "spanish - european": "es",
      "spanish - latin american": "es",
      spanish: "es",
      swedish: "sv",
      turkish: "tr",
      اَلْعَرَبِيَّةُ: "ar",
      বাংলা: "bn",
      filipino: "tl",
      indonesia: "id",
      اردو: "ur",
      English: "en",
      Arabic: "ar",
      Bosnian: "bs",
      Bulgarian: "bg",
      Croatian: "hr",
      Czech: "cs",
      Danish: "da",
      Dutch: "nl",
      Estonian: "et",
      Finnish: "fi",
      French: "fr",
      German: "de",
      Greek: "el",
      Hebrew: "he",
      Hungarian: "hu",
      Indonesian: "id",
      Italian: "it",
      Norwegian: "no",
      Persian: "fa",
      Polish: "pl",
      Portuguese: "pt",
      "Protuguese (BR)": "pt-br",
      Romanian: "ro",
      Russian: "ru",
      russian: "ru",
      Serbian: "sr",
      Slovenian: "sl",
      Spanish: "es",
      Swedish: "sv",
      Thai: "th",
      Turkish: "tr",
      // Simple language codes
      ng: "en",
      re: "fr",
      pa: "es"
    };
    const mappedCode = languageMap[label.toLowerCase()];
    if (mappedCode) return mappedCode;
    const code = ISO6391.getCode(label);
    if (code.length === 0) return null;
    return code;
  }
  function removeDuplicatedLanguages(list) {
    const beenSeen = {};
    return list.filter((sub) => {
      if (beenSeen[sub.language]) return false;
      beenSeen[sub.language] = true;
      return true;
    });
  }
  const origin = "https://rabbitstream.net";
  const referer$2 = "https://rabbitstream.net/";
  const { AES, enc } = crypto;
  function isJSON(json) {
    try {
      JSON.parse(json);
      return true;
    } catch {
      return false;
    }
  }
  function extractKey(script2) {
    const startOfSwitch = script2.lastIndexOf("switch");
    const endOfCases = script2.indexOf("partKeyStartPosition");
    const switchBody = script2.slice(startOfSwitch, endOfCases);
    const nums = [];
    const matches = switchBody.matchAll(/:[a-zA-Z0-9]+=([a-zA-Z0-9]+),[a-zA-Z0-9]+=([a-zA-Z0-9]+);/g);
    for (const match2 of matches) {
      const innerNumbers = [];
      for (const varMatch of [match2[1], match2[2]]) {
        const regex = new RegExp(`${varMatch}=0x([a-zA-Z0-9]+)`, "g");
        const varMatches = [...script2.matchAll(regex)];
        const lastMatch = varMatches[varMatches.length - 1];
        if (!lastMatch) return null;
        const number = parseInt(lastMatch[1], 16);
        innerNumbers.push(number);
      }
      nums.push([innerNumbers[0], innerNumbers[1]]);
    }
    return nums;
  }
  const upcloudScraper = makeEmbed({
    id: "upcloud",
    name: "UpCloud",
    rank: 200,
    disabled: true,
    async scrape(ctx2) {
      const parsedUrl = new URL(ctx2.url.replace("embed-5", "embed-4"));
      const dataPath = parsedUrl.pathname.split("/");
      const dataId = dataPath[dataPath.length - 1];
      const streamRes = await ctx2.proxiedFetcher(`${parsedUrl.origin}/ajax/embed-4/getSources?id=${dataId}`, {
        headers: {
          Referer: parsedUrl.origin,
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      let sources = null;
      if (!isJSON(streamRes.sources)) {
        const scriptJs = await ctx2.proxiedFetcher(`https://rabbitstream.net/js/player/prod/e4-player.min.js`, {
          query: {
            // browser side caching on this endpoint is quite extreme. Add version query paramter to circumvent any caching
            v: Date.now().toString()
          }
        });
        const decryptionKey = extractKey(scriptJs);
        if (!decryptionKey) throw new Error("Key extraction failed");
        let extractedKey = "";
        let strippedSources = streamRes.sources;
        let totalledOffset = 0;
        decryptionKey.forEach(([a, b]) => {
          const start = a + totalledOffset;
          const end = start + b;
          extractedKey += streamRes.sources.slice(start, end);
          strippedSources = strippedSources.replace(streamRes.sources.substring(start, end), "");
          totalledOffset += b;
        });
        const decryptedStream = AES.decrypt(strippedSources, extractedKey).toString(enc.Utf8);
        const parsedStream = JSON.parse(decryptedStream)[0];
        if (!parsedStream) throw new Error("No stream found");
        sources = parsedStream;
      }
      if (!sources) throw new Error("upcloud source not found");
      const captions = [];
      streamRes.tracks.forEach((track) => {
        if (track.kind !== "captions") return;
        const type = getCaptionTypeFromUrl(track.file);
        if (!type) return;
        const language = labelToLanguageCode(track.label.split(" ")[0]);
        if (!language) return;
        captions.push({
          id: track.file,
          language,
          hasCorsRestrictions: false,
          type,
          url: track.file
        });
      });
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: sources.file,
            flags: [flags.CORS_ALLOWED],
            captions,
            preferredHeaders: {
              Referer: referer$2,
              Origin: origin
            }
          }
        ]
      };
    }
  });
  const apiUrl = "https://tom.autoembed.cc";
  async function comboScraper$m(ctx2) {
    const mediaType = ctx2.media.type === "show" ? "tv" : "movie";
    let id = ctx2.media.tmdbId;
    if (ctx2.media.type === "show") {
      id = `${id}/${ctx2.media.season.number}/${ctx2.media.episode.number}`;
    }
    const data = await ctx2.proxiedFetcher(`/api/getVideoSource`, {
      baseUrl: apiUrl,
      query: {
        type: mediaType,
        id
      },
      headers: {
        Referer: apiUrl,
        Origin: apiUrl
      }
    });
    if (!data) throw new NotFoundError("Failed to fetch video source");
    if (!data.videoSource) throw new NotFoundError("No video source found");
    ctx2.progress(50);
    const embeds = [
      {
        embedId: `autoembed-english`,
        url: data.videoSource
      }
    ];
    ctx2.progress(90);
    return {
      embeds
    };
  }
  const autoembedScraper = makeSourcerer({
    id: "autoembed",
    name: "Autoembed",
    rank: 110,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$m,
    scrapeShow: comboScraper$m
  });
  function normalizeTitle$2(title) {
    let titleTrimmed = title.trim().toLowerCase();
    if (titleTrimmed !== "the movie" && titleTrimmed.endsWith("the movie")) {
      titleTrimmed = titleTrimmed.replace("the movie", "");
    }
    if (titleTrimmed !== "the series" && titleTrimmed.endsWith("the series")) {
      titleTrimmed = titleTrimmed.replace("the series", "");
    }
    return titleTrimmed.replace(/['":]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");
  }
  function compareTitle(a, b) {
    return normalizeTitle$2(a) === normalizeTitle$2(b);
  }
  function compareMedia(media, title, releaseYear) {
    const isSameYear = releaseYear === void 0 ? true : media.releaseYear === releaseYear;
    return compareTitle(media.title, title) && isSameYear;
  }
  function makeCookieHeader(cookies) {
    return Object.entries(cookies).map(([name, value]) => cookie.serialize(name, value)).join("; ");
  }
  function parseSetCookie(headerValue) {
    const splitHeaderValue = setCookieParser.splitCookiesString(headerValue);
    const parsedCookies = setCookieParser.parse(splitHeaderValue, {
      map: true
    });
    return parsedCookies;
  }
  const baseUrl$k = "https://ee3.me";
  const username = "_sf_";
  const password = "defonotscraping";
  async function login(user, pass, ctx2) {
    const req = await ctx2.proxiedFetcher.full("/login", {
      baseUrl: baseUrl$k,
      method: "POST",
      body: new URLSearchParams({ user, pass, action: "login" }),
      readHeaders: ["Set-Cookie"]
    });
    const res = JSON.parse(req.body);
    const cookie2 = parseSetCookie(
      // It retruns a cookie even when the login failed
      // I have the backup cookie here just in case
      res.status === 1 ? req.headers.get("Set-Cookie") ?? "" : "PHPSESSID=mk2p73c77qc28o5i5120843ruu;"
    );
    return cookie2.PHPSESSID.value;
  }
  function parseSearch$1(body) {
    const result = [];
    const $2 = cheerio.load(body);
    $2("div").each((_, element) => {
      const title = $2(element).find(".title").text().trim();
      const year = parseInt($2(element).find(".details span").first().text().trim(), 10);
      const id = $2(element).find(".control-buttons").attr("data-id");
      if (title && year && id) {
        result.push({ title, year, id });
      }
    });
    return result;
  }
  async function comboScraper$l(ctx2) {
    var _a, _b;
    const pass = await login(username, password, ctx2);
    if (!pass) throw new Error("Login failed");
    const search = parseSearch$1(
      await ctx2.proxiedFetcher("/get", {
        baseUrl: baseUrl$k,
        method: "POST",
        body: new URLSearchParams({ query: ctx2.media.title, action: "search" }),
        headers: {
          cookie: makeCookieHeader({ PHPSESSID: pass })
        }
      })
    );
    const id = (_a = search.find((v) => v && compareMedia(ctx2.media, v.title, v.year))) == null ? void 0 : _a.id;
    if (!id) throw new NotFoundError("No watchable item found");
    ctx2.progress(20);
    const details = JSON.parse(
      await ctx2.proxiedFetcher("/get", {
        baseUrl: baseUrl$k,
        method: "POST",
        body: new URLSearchParams({ id, action: "get_movie_info" }),
        headers: {
          cookie: makeCookieHeader({ PHPSESSID: pass })
        }
      })
    );
    if (!details.message.video) throw new Error("Failed to get the stream");
    ctx2.progress(40);
    const keyParams = JSON.parse(
      await ctx2.proxiedFetcher("/renew", {
        baseUrl: baseUrl$k,
        method: "POST",
        headers: {
          cookie: makeCookieHeader({ PHPSESSID: pass })
        }
      })
    );
    if (!keyParams.k) throw new Error("Failed to get the key");
    ctx2.progress(60);
    const server = details.message.server === "1" ? "https://vid.ee3.me/vid/" : "https://vault.rips.cc/video/";
    const k = keyParams.k;
    const url = `${server}${details.message.video}?${new URLSearchParams({ k })}`;
    const captions = [];
    if (((_b = details.message.subs) == null ? void 0 : _b.toLowerCase()) === "yes" && details.message.imdbID) {
      captions.push({
        id: `https://rips.cc/subs/${details.message.imdbID}.vtt`,
        url: `https://rips.cc/subs/${details.message.imdbID}.vtt`,
        type: "vtt",
        hasCorsRestrictions: false,
        language: "en"
      });
    }
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "file",
          flags: [flags.CORS_ALLOWED],
          captions,
          qualities: {
            // should be unknown, but all the videos are 720p
            720: {
              type: "mp4",
              url
            }
          }
        }
      ]
    };
  }
  const ee3Scraper = makeSourcerer({
    id: "ee3",
    name: "EE3",
    rank: 120,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$l
  });
  function getValidQualityFromString(quality) {
    switch (quality.toLowerCase().replace("p", "")) {
      case "360":
        return "360";
      case "480":
        return "480";
      case "720":
        return "720";
      case "1080":
        return "1080";
      case "2160":
        return "4k";
      case "4k":
        return "4k";
      default:
        return "unknown";
    }
  }
  const baseUrl$j = "https://fsharetv.co";
  async function comboScraper$k(ctx2) {
    var _a, _b;
    const searchPage = await ctx2.proxiedFetcher("/search", {
      baseUrl: baseUrl$j,
      query: {
        q: ctx2.media.title
      }
    });
    const search$ = cheerio.load(searchPage);
    const searchResults = [];
    search$(".movie-item").each((_, element) => {
      var _a2;
      const [, title, year] = ((_a2 = search$(element).find("b").text()) == null ? void 0 : _a2.match(/^(.*?)\s*(?:\(?\s*(\d{4})(?:\s*-\s*\d{0,4})?\s*\)?)?\s*$/)) || [];
      const url = search$(element).find("a").attr("href");
      if (!title || !url) return;
      searchResults.push({ title, year: Number(year) ?? void 0, url });
    });
    const watchPageUrl = (_a = searchResults.find((x) => x && compareMedia(ctx2.media, x.title, x.year))) == null ? void 0 : _a.url;
    if (!watchPageUrl) throw new NotFoundError("No watchable item found");
    ctx2.progress(50);
    const watchPage = await ctx2.proxiedFetcher(watchPageUrl.replace("/movie", "/w"), { baseUrl: baseUrl$j });
    const fileId = (_b = watchPage.match(/Movie\.setSource\('([^']*)'/)) == null ? void 0 : _b[1];
    if (!fileId) throw new Error("File ID not found");
    const apiRes = await ctx2.proxiedFetcher(
      `/api/file/${fileId}/source`,
      {
        baseUrl: baseUrl$j,
        query: {
          type: "watch"
        }
      }
    );
    if (!apiRes.data.file.sources.length) throw new Error("No sources found");
    const mediaBase = new URL((await ctx2.proxiedFetcher.full(apiRes.data.file.sources[0].src, { baseUrl: baseUrl$j })).finalUrl).origin;
    const qualities = apiRes.data.file.sources.reduce(
      (acc, source) => {
        const quality = typeof source.quality === "number" ? source.quality.toString() : source.quality;
        const validQuality = getValidQualityFromString(quality);
        acc[validQuality] = {
          type: "mp4",
          url: `${mediaBase}${source.src.replace("/api", "")}`
        };
        return acc;
      },
      {}
    );
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "file",
          flags: [],
          headers: {
            referer: "https://fsharetv.co"
          },
          qualities,
          captions: []
        }
      ]
    };
  }
  const fsharetvScraper = makeSourcerer({
    id: "fsharetv",
    name: "FshareTV",
    rank: 190,
    flags: [],
    scrapeMovie: comboScraper$k
  });
  const BASE_URL = "https://isut.streamflix.one";
  async function comboScraper$j(ctx2) {
    const embedPage = await ctx2.fetcher(
      `${BASE_URL}/api/source/${ctx2.media.type === "movie" ? `${ctx2.media.tmdbId}` : `${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}`}`
    );
    const sources = embedPage.sources;
    if (!sources || sources.length === 0) throw new NotFoundError("No sources found");
    const file = sources[0].file;
    if (!file) throw new NotFoundError("No file URL found");
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          playlist: file,
          type: "hls",
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
  const insertunitScraper = makeSourcerer({
    id: "insertunit",
    name: "Insertunit",
    rank: 12,
    disabled: true,
    flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
    scrapeMovie: comboScraper$j,
    scrapeShow: comboScraper$j
  });
  const baseUrl$i = "https://mp4hydra.org/";
  async function comboScraper$i(ctx2) {
    var _a;
    const searchPage = await ctx2.proxiedFetcher("/search", {
      baseUrl: baseUrl$i,
      query: {
        q: ctx2.media.title
      }
    });
    ctx2.progress(40);
    const $search = cheerio.load(searchPage);
    const searchResults = [];
    $search(".search-details").each((_, element) => {
      var _a2;
      const [, title, year] = $search(element).find("a").first().text().trim().match(/^(.*?)\s*(?:\(?\s*(\d{4})(?:\s*-\s*\d{0,4})?\s*\)?)?\s*$/) || [];
      const url = (_a2 = $search(element).find("a").attr("href")) == null ? void 0 : _a2.split("/")[4];
      if (!title || !url) return;
      searchResults.push({ title, year: year ? parseInt(year, 10) : void 0, url });
    });
    const s = (_a = searchResults.find((x) => x && compareMedia(ctx2.media, x.title, x.year))) == null ? void 0 : _a.url;
    if (!s) throw new NotFoundError("No watchable item found");
    ctx2.progress(60);
    const data = await ctx2.proxiedFetcher("/info2?v=8", {
      method: "POST",
      body: new URLSearchParams({ z: JSON.stringify([{ s, t: "movie" }]) }),
      baseUrl: baseUrl$i
    });
    if (!data.playlist[0].src || !data.servers) throw new NotFoundError("No watchable item found");
    ctx2.progress(80);
    const embeds = [];
    [
      data.servers[data.servers.auto],
      ...Object.values(data.servers).filter((x) => x !== data.servers[data.servers.auto] && x !== data.servers.auto)
    ].forEach(
      (server, _) => embeds.push({ embedId: `mp4hydra-${_ + 1}`, url: `${server}${data.playlist[0].src}|${data.playlist[0].label}` })
    );
    ctx2.progress(90);
    return {
      embeds
    };
  }
  const mp4hydraScraper = makeSourcerer({
    id: "mp4hydra",
    name: "Mp4Hydra",
    rank: 4,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$i,
    scrapeShow: comboScraper$i
  });
  const nepuBase = "https://nscrape.andresdev.org/api";
  async function scrape$2(ctx2) {
    const tmdbId = ctx2.media.tmdbId;
    let url;
    if (ctx2.media.type === "movie") {
      url = `${nepuBase}/get-stream?tmdbId=${tmdbId}`;
    } else {
      url = `${nepuBase}/get-show-stream?tmdbId=${tmdbId}&season=${ctx2.media.season.number}&episode=${ctx2.media.episode.number}`;
    }
    const response = await ctx2.proxiedFetcher(url);
    if (!response.success || !response.rurl) {
      throw new NotFoundError("No stream found");
    }
    return {
      stream: [
        {
          id: "nepu",
          type: "hls",
          playlist: response.rurl,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ],
      embeds: []
    };
  }
  const nepuScraper = makeSourcerer({
    id: "nepu",
    name: "Nepu",
    rank: 201,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: scrape$2,
    scrapeShow: scrape$2
  });
  const baseUrl$h = "https://mbp.pirxcy.dev";
  function buildQualitiesFromStreams(data) {
    const streams = data.list.reduce((acc, stream) => {
      const { path, quality, format } = stream;
      const realQuality = stream.real_quality;
      if (format !== "mp4") return acc;
      let qualityKey;
      if (quality === "4K" || realQuality === "4K") {
        qualityKey = 2160;
      } else {
        const qualityStr = quality.replace("p", "");
        qualityKey = parseInt(qualityStr, 10);
      }
      if (Number.isNaN(qualityKey) || acc[qualityKey]) return acc;
      acc[qualityKey] = path;
      return acc;
    }, {});
    const filteredStreams = Object.entries(streams).reduce((acc, [quality, url]) => {
      acc[quality] = url;
      return acc;
    }, {});
    return {
      ...filteredStreams[2160] && {
        "4k": {
          type: "mp4",
          url: filteredStreams[2160]
        }
      },
      ...filteredStreams[1080] && {
        1080: {
          type: "mp4",
          url: filteredStreams[1080]
        }
      },
      ...filteredStreams[720] && {
        720: {
          type: "mp4",
          url: filteredStreams[720]
        }
      },
      ...filteredStreams[480] && {
        480: {
          type: "mp4",
          url: filteredStreams[480]
        }
      },
      ...filteredStreams[360] && {
        360: {
          type: "mp4",
          url: filteredStreams[360]
        }
      },
      ...filteredStreams.unknown && {
        unknown: {
          type: "mp4",
          url: filteredStreams.unknown
        }
      }
    };
  }
  async function findMediaByTMDBId(ctx2, tmdbId, title, type, year) {
    const searchUrl = `${baseUrl$h}/search?q=${encodeURIComponent(title)}&type=${type}${year ? `&year=${year}` : ""}`;
    const searchRes = await ctx2.proxiedFetcher(searchUrl);
    if (!searchRes.data || searchRes.data.length === 0) {
      throw new NotFoundError("No results found in search");
    }
    for (const result of searchRes.data) {
      const detailUrl = `${baseUrl$h}/details/${type}/${result.id}`;
      const detailRes = await ctx2.proxiedFetcher(detailUrl);
      if (detailRes.data && detailRes.data.tmdb_id.toString() === tmdbId) {
        return result.id;
      }
    }
    throw new NotFoundError("Could not find matching media item for TMDB ID");
  }
  async function scrapeMovie(ctx2) {
    var _a;
    const tmdbId = ctx2.media.tmdbId;
    const title = ctx2.media.title;
    const year = (_a = ctx2.media.releaseYear) == null ? void 0 : _a.toString();
    if (!tmdbId || !title) {
      throw new NotFoundError("Missing required media information");
    }
    const mediaId = await findMediaByTMDBId(ctx2, tmdbId, title, "movie", year);
    const streamUrl = `${baseUrl$h}/movie/${mediaId}`;
    const streamData = await ctx2.proxiedFetcher(streamUrl);
    if (!streamData.data || !streamData.data.list) {
      throw new NotFoundError("No streams found for this movie");
    }
    const qualities = buildQualitiesFromStreams(streamData.data);
    return {
      stream: [
        {
          id: "pirxcy",
          type: "file",
          qualities,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ],
      embeds: []
    };
  }
  async function scrapeShow(ctx2) {
    var _a;
    const tmdbId = ctx2.media.tmdbId;
    const title = ctx2.media.title;
    const year = (_a = ctx2.media.releaseYear) == null ? void 0 : _a.toString();
    const season = ctx2.media.season.number;
    const episode = ctx2.media.episode.number;
    if (!tmdbId || !title || !season || !episode) {
      throw new NotFoundError("Missing required media information");
    }
    const mediaId = await findMediaByTMDBId(ctx2, tmdbId, title, "tv", year);
    const streamUrl = `${baseUrl$h}/tv/${mediaId}/${season}/${episode}`;
    const streamData = await ctx2.proxiedFetcher(streamUrl);
    if (!streamData.data || !streamData.data.list) {
      throw new NotFoundError("No streams found for this episode");
    }
    const qualities = buildQualitiesFromStreams(streamData.data);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "file",
          qualities,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
  const pirxcyScraper = makeSourcerer({
    id: "pirxcy",
    name: "Pirxcy",
    rank: 230,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie,
    scrapeShow
  });
  const baseUrl$g = "https://tugaflix.love/";
  function parseSearch(page) {
    const results = [];
    const $2 = cheerio.load(page);
    $2(".items .poster").each((_, element) => {
      var _a;
      const $link = $2(element).find("a");
      const url = $link.attr("href");
      const [, title, year] = ((_a = $link.attr("title")) == null ? void 0 : _a.match(/^(.*?)\s*(?:\((\d{4})\))?\s*$/)) || [];
      if (!title || !url) return;
      results.push({ title, year: year ? parseInt(year, 10) : void 0, url });
    });
    return results;
  }
  const tugaflixScraper = makeSourcerer({
    id: "tugaflix",
    name: "Tugaflix",
    rank: 70,
    flags: [flags.IP_LOCKED],
    scrapeMovie: async (ctx2) => {
      var _a;
      const searchResults = parseSearch(
        await ctx2.proxiedFetcher("/filmes/", {
          baseUrl: baseUrl$g,
          query: {
            s: ctx2.media.title
          }
        })
      );
      if (searchResults.length === 0) throw new NotFoundError("No watchable item found");
      const url = (_a = searchResults.find((x) => x && compareMedia(ctx2.media, x.title, x.year))) == null ? void 0 : _a.url;
      if (!url) throw new NotFoundError("No watchable item found");
      ctx2.progress(50);
      const videoPage = await ctx2.proxiedFetcher(url, {
        method: "POST",
        body: new URLSearchParams({ play: "" })
      });
      const $2 = cheerio.load(videoPage);
      const embeds = [];
      for (const element of $2(".play a")) {
        const embedUrl = $2(element).attr("href");
        if (!embedUrl) continue;
        const embedPage = await ctx2.proxiedFetcher.full(
          embedUrl.startsWith("https://") ? embedUrl : `https://${embedUrl}`
        );
        const finalUrl = cheerio.load(embedPage.body)('a:contains("Download Filme")').attr("href");
        if (!finalUrl) continue;
        if (finalUrl.includes("streamtape")) {
          embeds.push({
            embedId: "streamtape",
            url: finalUrl
          });
        } else if (finalUrl.includes("dood")) {
          embeds.push({
            embedId: "dood",
            url: finalUrl
          });
        }
      }
      ctx2.progress(90);
      return {
        embeds
      };
    },
    scrapeShow: async (ctx2) => {
      var _a;
      const searchResults = parseSearch(
        await ctx2.proxiedFetcher("/series/", {
          baseUrl: baseUrl$g,
          query: {
            s: ctx2.media.title
          }
        })
      );
      if (searchResults.length === 0) throw new NotFoundError("No watchable item found");
      const url = (_a = searchResults.find((x) => x && compareMedia(ctx2.media, x.title, x.year))) == null ? void 0 : _a.url;
      if (!url) throw new NotFoundError("No watchable item found");
      ctx2.progress(50);
      const s = ctx2.media.season.number < 10 ? `0${ctx2.media.season.number}` : ctx2.media.season.number.toString();
      const e = ctx2.media.episode.number < 10 ? `0${ctx2.media.episode.number}` : ctx2.media.episode.number.toString();
      const videoPage = await ctx2.proxiedFetcher(url, {
        method: "POST",
        body: new URLSearchParams({ [`S${s}E${e}`]: "" })
      });
      const embedUrl = cheerio.load(videoPage)('iframe[name="player"]').attr("src");
      if (!embedUrl) throw new Error("Failed to find iframe");
      const playerPage = await ctx2.proxiedFetcher(embedUrl.startsWith("https:") ? embedUrl : `https:${embedUrl}`, {
        method: "POST",
        body: new URLSearchParams({ submit: "" })
      });
      const embeds = [];
      const finalUrl = cheerio.load(playerPage)('a:contains("Download Episodio")').attr("href");
      if (finalUrl == null ? void 0 : finalUrl.includes("streamtape")) {
        embeds.push({
          embedId: "streamtape",
          url: finalUrl
        });
      } else if (finalUrl == null ? void 0 : finalUrl.includes("dood")) {
        embeds.push({
          embedId: "dood",
          url: finalUrl
        });
      }
      ctx2.progress(90);
      return {
        embeds
      };
    }
  });
  const abc = String.fromCharCode(
    65,
    66,
    67,
    68,
    69,
    70,
    71,
    72,
    73,
    74,
    75,
    76,
    77,
    97,
    98,
    99,
    100,
    101,
    102,
    103,
    104,
    105,
    106,
    107,
    108,
    109,
    78,
    79,
    80,
    81,
    82,
    83,
    84,
    85,
    86,
    87,
    88,
    89,
    90,
    110,
    111,
    112,
    113,
    114,
    115,
    116,
    117,
    118,
    119,
    120,
    121,
    122
  );
  const dechar = (x) => String.fromCharCode(x);
  const salt = {
    _keyStr: `${abc}0123456789+/=`,
    e(input) {
      let t = "";
      let n;
      let r;
      let i;
      let s;
      let o2;
      let u;
      let a;
      let f = 0;
      input = salt._ue(input);
      while (f < input.length) {
        n = input.charCodeAt(f++);
        r = input.charCodeAt(f++);
        i = input.charCodeAt(f++);
        s = n >> 2;
        o2 = (n & 3) << 4 | r >> 4;
        u = (r & 15) << 2 | i >> 6;
        a = i & 63;
        if (Number.isNaN(r)) {
          u = 64;
          a = 64;
        } else if (Number.isNaN(i)) {
          a = 64;
        }
        t += this._keyStr.charAt(s) + this._keyStr.charAt(o2) + this._keyStr.charAt(u) + this._keyStr.charAt(a);
      }
      return t;
    },
    d(encoded) {
      let t = "";
      let n;
      let r;
      let i;
      let s;
      let o2;
      let u;
      let a;
      let f = 0;
      encoded = encoded.replace(/[^A-Za-z0-9+/=]/g, "");
      while (f < encoded.length) {
        s = this._keyStr.indexOf(encoded.charAt(f++));
        o2 = this._keyStr.indexOf(encoded.charAt(f++));
        u = this._keyStr.indexOf(encoded.charAt(f++));
        a = this._keyStr.indexOf(encoded.charAt(f++));
        n = s << 2 | o2 >> 4;
        r = (o2 & 15) << 4 | u >> 2;
        i = (u & 3) << 6 | a;
        t += dechar(n);
        if (u !== 64) t += dechar(r);
        if (a !== 64) t += dechar(i);
      }
      t = salt._ud(t);
      return t;
    },
    _ue(input) {
      input = input.replace(/\r\n/g, "\n");
      let t = "";
      for (let n = 0; n < input.length; n++) {
        const r = input.charCodeAt(n);
        if (r < 128) {
          t += dechar(r);
        } else if (r > 127 && r < 2048) {
          t += dechar(r >> 6 | 192);
          t += dechar(r & 63 | 128);
        } else {
          t += dechar(r >> 12 | 224);
          t += dechar(r >> 6 & 63 | 128);
          t += dechar(r & 63 | 128);
        }
      }
      return t;
    },
    _ud(input) {
      let t = "";
      let n = 0;
      let r;
      let c2;
      let c3;
      while (n < input.length) {
        r = input.charCodeAt(n);
        if (r < 128) {
          t += dechar(r);
          n++;
        } else if (r > 191 && r < 224) {
          c2 = input.charCodeAt(n + 1);
          t += dechar((r & 31) << 6 | c2 & 63);
          n += 2;
        } else {
          c2 = input.charCodeAt(n + 1);
          c3 = input.charCodeAt(n + 2);
          t += dechar((r & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
          n += 3;
        }
      }
      return t;
    }
  };
  const sugar = (input) => {
    const parts = input.split(dechar(61));
    let result = "";
    const c1 = dechar(120);
    for (const part of parts) {
      let encoded = "";
      for (let i = 0; i < part.length; i++) {
        encoded += part[i] === c1 ? dechar(49) : dechar(48);
      }
      const chr = parseInt(encoded, 2);
      result += dechar(chr);
    }
    return result.substring(0, result.length - 1);
  };
  const pepper = (s, n) => {
    s = s.replace(/\+/g, "#");
    s = s.replace(/#/g, "+");
    const yValue = "xx??x?=xx?xx?=";
    let a = Number(sugar(yValue)) * n;
    a += abc.length / 2;
    const r = abc.substr(a * 2) + abc.substr(0, a * 2);
    return s.replace(/[A-Za-z]/g, (c) => r.charAt(abc.indexOf(c)));
  };
  const decode = (x) => {
    if (x.substr(0, 2) === "#1") {
      return salt.d(pepper(x.substr(2), -1));
    }
    if (x.substr(0, 2) === "#0") {
      return salt.d(x.substr(2));
    }
    return x;
  };
  const mirza = (encodedUrl, v) => {
    let a = encodedUrl.substring(2);
    for (let i = 4; i >= 0; i--) {
      if (v[`bk${i}`]) {
        const b1 = (str) => btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
        a = a.replace(v.file3_separator + b1(v[`bk${i}`]), "");
      }
    }
    const b2 = (str) => decodeURIComponent(
      atob(str).split("").map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`).join("")
    );
    return b2(a);
  };
  const o = {
    u: "#1RyJzl3JYmljm0mkJWOGYWNyI6MfwVNGYXmj9uQj5tQkeYIWoxLCJXNkawOGF5QZ9sQj1YIWowLCJXO20VbVJ1OZ11QGiSlni0QG9uIn19"
  };
  async function vidsrcScrape(ctx2) {
    var _a, _b;
    const imdbId = ctx2.media.imdbId;
    if (!imdbId) throw new NotFoundError("IMDb ID not found");
    const isShow = ctx2.media.type === "show";
    let season;
    let episode;
    if (isShow) {
      const show = ctx2.media;
      season = (_a = show.season) == null ? void 0 : _a.number;
      episode = (_b = show.episode) == null ? void 0 : _b.number;
    }
    const embedUrl = isShow ? `https://vidsrc.net/embed/tv?imdb=${imdbId}&season=${season}&episode=${episode}` : `https://vidsrc.net/embed/${imdbId}`;
    ctx2.progress(10);
    const embedHtml = await ctx2.proxiedFetcher(embedUrl, {
      headers: {
        Referer: "https://vidsrc.net/",
        "User-Agent": "Mozilla/5.0"
      }
    });
    ctx2.progress(30);
    const iframeMatch = embedHtml.match(/<iframe[^>]*id="player_iframe"[^>]*src="([^"]*)"[^>]*>/);
    if (!iframeMatch) throw new NotFoundError("Initial iframe not found");
    const rcpUrl = iframeMatch[1].startsWith("//") ? `https:${iframeMatch[1]}` : iframeMatch[1];
    ctx2.progress(50);
    const rcpHtml = await ctx2.proxiedFetcher(rcpUrl, {
      headers: { Referer: embedUrl, "User-Agent": "Mozilla/5.0" }
    });
    const scriptMatch = rcpHtml.match(/src\s*:\s*['"]([^'"]+)['"]/);
    if (!scriptMatch) throw new NotFoundError("prorcp iframe not found");
    const prorcpUrl = scriptMatch[1].startsWith("/") ? `https://cloudnestra.com${scriptMatch[1]}` : scriptMatch[1];
    ctx2.progress(70);
    const finalHtml = await ctx2.proxiedFetcher(prorcpUrl, {
      headers: { Referer: rcpUrl, "User-Agent": "Mozilla/5.0" }
    });
    const scripts = finalHtml.split("<script");
    let scriptWithPlayer = "";
    for (const script2 of scripts) {
      if (script2.includes("Playerjs")) {
        scriptWithPlayer = script2;
        break;
      }
    }
    if (!scriptWithPlayer) throw new NotFoundError("No Playerjs config found");
    const m3u8Match = scriptWithPlayer.match(/file\s*:\s*['"]([^'"]+)['"]/);
    if (!m3u8Match) throw new NotFoundError("No file field in Playerjs");
    let streamUrl = m3u8Match[1];
    if (!streamUrl.includes(".m3u8")) {
      const v = JSON.parse(decode(o.u));
      streamUrl = mirza(streamUrl, v);
    }
    ctx2.progress(90);
    const headers2 = {
      referer: "https://cloudnestra.com/",
      origin: "https://cloudnestra.com"
    };
    return {
      stream: [
        {
          id: "vidsrc-cloudnestra",
          type: "hls",
          playlist: streamUrl,
          headers: headers2,
          proxyDepth: 2,
          flags: [],
          captions: []
        }
      ],
      embeds: []
    };
  }
  const vidsrcScraper = makeSourcerer({
    id: "cloudnestra",
    name: "Cloudnestra",
    rank: 180,
    flags: [],
    disabled: false,
    scrapeMovie: vidsrcScrape,
    scrapeShow: vidsrcScrape
  });
  const baseUrl$f = "https://api2.vidsrc.vip";
  function digitToLetterMap(digit) {
    const map = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    return map[parseInt(digit, 10)];
  }
  function encodeTmdbId(tmdb, type, season, episode) {
    let raw;
    if (type === "show" && season && episode) {
      raw = `${tmdb}-${season}-${episode}`;
    } else {
      raw = tmdb.split("").map(digitToLetterMap).join("");
    }
    const reversed = raw.split("").reverse().join("");
    return btoa(btoa(reversed));
  }
  async function comboScraper$h(ctx2) {
    const apiType = ctx2.media.type === "show" ? "tv" : "movie";
    const encodedId = encodeTmdbId(
      ctx2.media.tmdbId,
      ctx2.media.type,
      ctx2.media.type === "show" ? ctx2.media.season.number : void 0,
      ctx2.media.type === "show" ? ctx2.media.episode.number : void 0
    );
    const url = `${baseUrl$f}/${apiType}/${encodedId}`;
    const data = await ctx2.proxiedFetcher(url);
    if (!data || !data.source1) throw new NotFoundError("No sources found");
    const embeds = [];
    const embedIds = ["vidsrc-comet", "vidsrc-pulsar", "vidsrc-nova"];
    let sourceIndex = 0;
    for (let i = 1; data[`source${i}`]; i++) {
      const source = data[`source${i}`];
      if (source == null ? void 0 : source.url) {
        embeds.push({
          embedId: embedIds[sourceIndex % embedIds.length],
          url: source.url
        });
        sourceIndex++;
      }
    }
    if (embeds.length === 0) throw new NotFoundError("No embeds found");
    return {
      embeds
    };
  }
  const vidsrcvipScraper = makeSourcerer({
    id: "vidsrcvip",
    name: "VidSrc.vip",
    rank: 150,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$h,
    scrapeShow: comboScraper$h
  });
  const zoeBase = "https://zoechip.org";
  function createSlug(title) {
    return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
  }
  async function extractFileFromFilemoon(ctx2, filemoonUrl) {
    const headers2 = {
      Referer: zoeBase,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    };
    const redirectResponse = await ctx2.proxiedFetcher.full(filemoonUrl, {
      method: "HEAD",
      headers: headers2
    });
    const redirectUrl = redirectResponse.finalUrl;
    if (!redirectUrl) {
      return null;
    }
    const redirectHtml = await ctx2.proxiedFetcher(redirectUrl, {
      headers: headers2
    });
    const redirectCheerio = cheerio.load(redirectHtml);
    const iframeUrl = redirectCheerio("iframe").attr("src");
    if (!iframeUrl) {
      throw new NotFoundError("No iframe URL found");
    }
    const iframeHtml = await ctx2.proxiedFetcher(iframeUrl, {
      headers: headers2
    });
    const evalMatch = iframeHtml.match(/eval\(function\(p,a,c,k,e,.*\)\)/i);
    if (!evalMatch) {
      throw new NotFoundError("No packed JavaScript found");
    }
    const unpacked = unpacker.unpack(evalMatch[0]);
    const fileMatch = unpacked.match(/file\s*:\s*"([^"]+)"/i);
    if (!fileMatch) {
      throw new NotFoundError("No file URL found in unpacked JavaScript");
    }
    const fileUrl = fileMatch[1];
    return fileUrl;
  }
  async function comboScraper$g(ctx2) {
    const headers2 = {
      Referer: zoeBase,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    };
    let url;
    let movieId;
    if (ctx2.media.type === "movie") {
      const slug = createSlug(ctx2.media.title);
      url = `${zoeBase}/film/${slug}-${ctx2.media.releaseYear}`;
    } else {
      const slug = createSlug(ctx2.media.title);
      url = `${zoeBase}/episode/${slug}-season-${ctx2.media.season.number}-episode-${ctx2.media.episode.number}`;
    }
    ctx2.progress(20);
    const html2 = await ctx2.proxiedFetcher(url, { headers: headers2 });
    const $2 = cheerio.load(html2);
    movieId = $2("div#show_player_ajax").attr("movie-id");
    if (!movieId) {
      const altId = $2("[data-movie-id]").attr("data-movie-id") || $2("[movie-id]").attr("movie-id") || $2(".player-wrapper").attr("data-id");
      if (altId) {
        movieId = altId;
      } else {
        throw new NotFoundError(`No content found for ${ctx2.media.type === "movie" ? "movie" : "episode"}`);
      }
    }
    ctx2.progress(40);
    const ajaxUrl = `${zoeBase}/wp-admin/admin-ajax.php`;
    const ajaxHeaders = {
      ...headers2,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: url
    };
    const body = new URLSearchParams({
      action: "lazy_player",
      movieID: movieId
    });
    const ajaxHtml = await ctx2.proxiedFetcher(ajaxUrl, {
      method: "POST",
      headers: ajaxHeaders,
      body: body.toString()
    });
    const $ajax = cheerio.load(ajaxHtml);
    const filemoonUrl = $ajax("ul.nav a:contains(Filemoon)").attr("data-server");
    if (!filemoonUrl) {
      const allServers = $ajax("ul.nav a").map((_, el) => ({
        name: $ajax(el).text().trim(),
        url: $ajax(el).attr("data-server")
      })).get();
      if (allServers.length === 0) {
        throw new NotFoundError("No streaming servers found");
      }
      throw new NotFoundError("Filemoon server not available");
    }
    ctx2.progress(60);
    const fileUrl = await extractFileFromFilemoon(ctx2, filemoonUrl);
    if (!fileUrl) {
      throw new NotFoundError("Failed to extract file URL from streaming server");
    }
    ctx2.progress(90);
    return {
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: fileUrl,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ],
      embeds: []
    };
  }
  const zoechipScraper = makeSourcerer({
    id: "zoechip",
    name: "ZoeChip",
    rank: 170,
    disabled: true,
    flags: [],
    scrapeMovie: comboScraper$g,
    scrapeShow: comboScraper$g
  });
  const ANIMETSU_SERVERS = ["pahe", "zoro", "zaza", "meg", "bato"];
  const baseUrl$e = "https://backend.animetsu.to";
  const headers$3 = {
    referer: "https://animetsu.to/",
    origin: "https://backend.animetsu.to",
    accept: "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };
  function makeAnimetsuEmbed(id, rank = 100) {
    return makeEmbed({
      id: `animetsu-${id}`,
      name: `${id.charAt(0).toUpperCase() + id.slice(1)}`,
      rank,
      async scrape(ctx2) {
        var _a;
        const serverName = id;
        const query = JSON.parse(ctx2.url);
        const { type, anilistId, episode } = query;
        if (type !== "movie" && type !== "show") {
          throw new NotFoundError("Unsupported media type");
        }
        const res = await ctx2.proxiedFetcher(`/api/anime/tiddies`, {
          baseUrl: baseUrl$e,
          headers: headers$3,
          query: {
            server: serverName,
            id: String(anilistId),
            num: String(episode ?? 1),
            subType: "dub"
          }
        });
        console.log("Animetsu API Response:", JSON.stringify(res, null, 2));
        const source = (_a = res == null ? void 0 : res.sources) == null ? void 0 : _a[0];
        if (!(source == null ? void 0 : source.url)) throw new NotFoundError("No source URL found");
        const streamUrl = source.url;
        const sourceType = source.type;
        const sourceQuality = source.quality;
        let streamHeaders = { ...headers$3 };
        if (streamUrl.includes("animetsu.cc")) {
          const { referer: referer2, origin: origin2, ...restHeaders } = streamHeaders;
          streamHeaders = {
            ...restHeaders,
            origin: "https://backend.animetsu.cc",
            referer: "https://backend.animetsu.cc/"
          };
        }
        ctx2.progress(100);
        if (sourceType === "mp4") {
          let qualityKey = "unknown";
          if (sourceQuality) {
            const qualityMatch = sourceQuality.match(/(\d+)p?/);
            if (qualityMatch) {
              qualityKey = parseInt(qualityMatch[1], 10);
            }
          }
          return {
            stream: [
              {
                id: "primary",
                captions: [],
                qualities: {
                  [qualityKey]: {
                    type: "mp4",
                    url: streamUrl
                  }
                },
                type: "file",
                headers: streamHeaders,
                flags: []
              }
            ]
          };
        }
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: streamUrl,
              headers: streamHeaders,
              flags: [],
              captions: []
            }
          ]
        };
      }
    });
  }
  const AnimetsuEmbeds = ANIMETSU_SERVERS.map((server, i) => makeAnimetsuEmbed(server, 300 - i));
  const providers$4 = [
    {
      id: "autoembed-english",
      rank: 10
    },
    {
      id: "autoembed-hindi",
      rank: 9,
      disabled: true
    },
    {
      id: "autoembed-tamil",
      rank: 8,
      disabled: true
    },
    {
      id: "autoembed-telugu",
      rank: 7,
      disabled: true
    },
    {
      id: "autoembed-bengali",
      rank: 6,
      disabled: true
    }
  ];
  function embed$4(provider) {
    return makeEmbed({
      id: provider.id,
      name: provider.id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" "),
      disabled: provider.disabled,
      rank: provider.rank,
      async scrape(ctx2) {
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: ctx2.url,
              flags: [flags.CORS_ALLOWED],
              captions: []
            }
          ]
        };
      }
    });
  }
  const [
    autoembedEnglishScraper,
    autoembedHindiScraper,
    autoembedBengaliScraper,
    autoembedTamilScraper,
    autoembedTeluguScraper
  ] = providers$4.map(embed$4);
  const CINEMAOS_API = atob("aHR0cHM6Ly9jaW5lbWFvcy12My52ZXJjZWwuYXBwL2FwaS9uZW8vYmFja2VuZGZldGNo");
  function makeCinemaOSEmbed(server, rank) {
    return makeEmbed({
      id: `cinemaos-${server}`,
      name: `${server.charAt(0).toUpperCase() + server.slice(1)}`,
      rank,
      disabled: true,
      async scrape(ctx2) {
        var _a;
        const query = JSON.parse(ctx2.url);
        const { tmdbId, type, season, episode } = query;
        let url = `${CINEMAOS_API}?requestID=${type === "show" ? "tvVideoProvider" : "movieVideoProvider"}&id=${tmdbId}&service=${server}`;
        if (type === "show") {
          url += `&season=${season}&episode=${episode}`;
        }
        const res = await ctx2.proxiedFetcher(url);
        const data = typeof res === "string" ? JSON.parse(res) : res;
        const sources = (_a = data == null ? void 0 : data.data) == null ? void 0 : _a.sources;
        if (!sources || !Array.isArray(sources) || sources.length === 0) {
          throw new NotFoundError("No sources found");
        }
        ctx2.progress(80);
        if (sources.length === 1) {
          return {
            stream: [
              {
                id: "primary",
                type: "hls",
                playlist: sources[0].url,
                flags: [flags.CORS_ALLOWED],
                captions: []
              }
            ]
          };
        }
        const qualityMap = {};
        for (const src of sources) {
          const quality = (src.quality || src.source || "unknown").toString();
          let qualityKey;
          if (quality === "4K") {
            qualityKey = 2160;
          } else {
            qualityKey = parseInt(quality.replace("P", ""), 10);
          }
          if (Number.isNaN(qualityKey) || qualityMap[qualityKey]) continue;
          qualityMap[qualityKey] = {
            type: "mp4",
            url: src.url
          };
        }
        return {
          stream: [
            {
              id: "primary",
              type: "file",
              flags: [flags.CORS_ALLOWED],
              qualities: qualityMap,
              captions: []
            }
          ]
        };
      }
    });
  }
  const CINEMAOS_SERVERS$1 = [
    //   'flowcast',
    "shadow",
    "asiacloud",
    //   'hindicast',
    //   'anime',
    //   'animez',
    //   'guard',
    //   'hq',
    //   'ninja',
    //   'alpha',
    //   'kaze',
    //   'zenith',
    //   'cast',
    //   'ghost',
    //   'halo',
    //   'kinoecho',
    //   'ee3',
    //   'volt',
    //   'putafilme',
    "ophim"
    //   'kage',
  ];
  const cinemaosEmbeds = CINEMAOS_SERVERS$1.map((server, i) => makeCinemaOSEmbed(server, 300 - i));
  function makeCinemaOSHexaEmbed(id, rank = 100) {
    return makeEmbed({
      id: `cinemaos-hexa-${id}`,
      name: `Hexa ${id.charAt(0).toUpperCase() + id.slice(1)}`,
      disabled: true,
      rank,
      async scrape(ctx2) {
        const query = JSON.parse(ctx2.url);
        const directUrl = query.directUrl;
        if (!directUrl) {
          throw new NotFoundError("No directUrl provided for Hexa embed");
        }
        const headers2 = {
          referer: "https://megacloud.store/",
          origin: "https://megacloud.store"
        };
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: createM3U8ProxyUrl(directUrl, headers2),
              flags: [flags.CORS_ALLOWED],
              captions: []
            }
          ]
        };
      }
    });
  }
  const HEXA_SERVERS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"];
  HEXA_SERVERS.map((server, i) => makeCinemaOSHexaEmbed(server, 315 - i));
  function customAtob(input) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    const str = input.replace(/=+$/, "");
    let output = "";
    if (str.length % 4 === 1) {
      throw new Error("The string to be decoded is not correctly encoded.");
    }
    for (let bc = 0, bs = 0, i = 0; i < str.length; i++) {
      const buffer = str.charAt(i);
      const charIndex = chars.indexOf(buffer);
      if (charIndex === -1) continue;
      bs = bc % 4 ? bs * 64 + charIndex : charIndex;
      if (bc++ % 4) {
        output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
      }
    }
    return output;
  }
  function decodeCloseload(valueParts) {
    const value = valueParts.join("");
    let result = value;
    result = atob(result);
    result = result.replace(/[a-zA-Z]/g, function rot13Transform(c) {
      const charCode = c.charCodeAt(0);
      const newCharCode = charCode + 13;
      const maxCode = c <= "Z" ? 90 : 122;
      return String.fromCharCode(newCharCode <= maxCode ? newCharCode : newCharCode - 26);
    });
    result = result.split("").reverse().join("");
    let unmix = "";
    for (let i = 0; i < result.length; i++) {
      let charCode = result.charCodeAt(i);
      charCode = (charCode - 399756995 % (i + 5) + 256) % 256;
      unmix += String.fromCharCode(charCode);
    }
    return unmix;
  }
  const referer$1 = "https://ridomovies.tv/";
  const closeLoadScraper = makeEmbed({
    id: "closeload",
    name: "CloseLoad",
    rank: 106,
    async scrape(ctx2) {
      const baseUrl3 = new URL(ctx2.url).origin;
      const iframeRes = await ctx2.proxiedFetcher(ctx2.url, {
        headers: { referer: referer$1 }
      });
      const iframeRes$ = cheerio.load(iframeRes);
      const captions = iframeRes$("track").map((_, el) => {
        const track = iframeRes$(el);
        const url2 = `${baseUrl3}${track.attr("src")}`;
        const label = track.attr("label") ?? "";
        const language = labelToLanguageCode(label);
        const captionType = getCaptionTypeFromUrl(url2);
        if (!language || !captionType) return null;
        return {
          id: url2,
          language,
          hasCorsRestrictions: true,
          type: captionType,
          url: url2
        };
      }).get().filter((x) => x !== null);
      const evalCode = iframeRes$("script").filter((_, el) => {
        var _a;
        const script2 = iframeRes$(el);
        return (script2.attr("type") === "text/javascript" && ((_a = script2.html()) == null ? void 0 : _a.includes("p,a,c,k,e,d"))) ?? false;
      }).html();
      if (!evalCode) throw new Error("Couldn't find eval code");
      const decoded = unpacker.unpack(evalCode);
      let base64EncodedUrl;
      const functionCallMatch = decoded.match(/dc_\w+\(\[([^\]]+)\]\)/);
      if (functionCallMatch) {
        const arrayContent = functionCallMatch[1];
        const stringMatches = arrayContent.match(/"([^"]+)"/g);
        if (stringMatches) {
          const valueParts = stringMatches.map((s) => s.slice(1, -1));
          try {
            const decodedUrl = decodeCloseload(valueParts);
            if (decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")) {
              base64EncodedUrl = decodedUrl;
            }
          } catch (error) {
          }
        }
      }
      if (!base64EncodedUrl) {
        const patterns = [/var\s+(\w+)\s*=\s*"([^"]+)";/g, /(\w+)\s*=\s*"([^"]+)"/g, /"([A-Za-z0-9+/=]+)"/g];
        for (const pattern of patterns) {
          const match2 = pattern.exec(decoded);
          if (match2) {
            const potentialUrl = match2[2] || match2[1];
            if (/^[A-Za-z0-9+/]*={0,2}$/.test(potentialUrl) && potentialUrl.length > 10) {
              base64EncodedUrl = potentialUrl;
              break;
            }
          }
        }
      }
      if (!base64EncodedUrl) throw new NotFoundError("Unable to find source url");
      let url;
      if (base64EncodedUrl.startsWith("http://") || base64EncodedUrl.startsWith("https://")) {
        url = base64EncodedUrl;
      } else {
        const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(base64EncodedUrl);
        if (!isValidBase64) {
          throw new NotFoundError("Invalid base64 encoding found in source url");
        }
        let decodedString;
        try {
          decodedString = atob(base64EncodedUrl);
        } catch (error) {
          try {
            decodedString = customAtob(base64EncodedUrl);
          } catch (customError) {
            throw new NotFoundError(`Failed to decode base64 source url: ${base64EncodedUrl.substring(0, 50)}...`);
          }
        }
        const urlMatch = decodedString.match(/(https?:\/\/[^\s"']+)/);
        if (urlMatch) {
          url = urlMatch[1];
        } else if (decodedString.startsWith("http://") || decodedString.startsWith("https://")) {
          url = decodedString;
        } else {
          throw new NotFoundError(`Decoded string is not a valid URL: ${decodedString.substring(0, 100)}...`);
        }
      }
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: url,
            captions,
            flags: [flags.IP_LOCKED],
            headers: {
              Referer: "https://closeload.top/",
              Origin: "https://closeload.top"
            }
          }
        ]
      };
    }
  });
  const baseUrl$d = "madplay.site";
  const headers$2 = {
    referer: "https://madplay.site/",
    origin: "https://madplay.site",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };
  const madplayBaseEmbed = makeEmbed({
    id: "madplay-base",
    name: "Base",
    rank: 134,
    async scrape(ctx2) {
      const query = JSON.parse(ctx2.url);
      const { type, tmdbId, season, episode } = query;
      let url = `https://${baseUrl$d}/api/playsrc`;
      if (type === "movie") {
        url += `?id=${tmdbId}`;
      } else if (type === "show") {
        url += `?id=${tmdbId}&season=${season}&episode=${episode}`;
      }
      const res = await ctx2.proxiedFetcher(url, { headers: headers$2 });
      console.log(res);
      if (!Array.isArray(res) || res.length === 0) {
        throw new NotFoundError("No streams found");
      }
      const stream = res[0];
      if (!stream.file) {
        throw new NotFoundError("No file URL found in stream");
      }
      ctx2.progress(100);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(stream.file, headers$2),
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
  const madplayNsapiEmbed = makeEmbed({
    id: "madplay-nsapi",
    name: "Northstar",
    rank: 133,
    async scrape(ctx2) {
      const query = JSON.parse(ctx2.url);
      const { type, tmdbId, season, episode } = query;
      let url = `https://${baseUrl$d}/api/nsapi/vid`;
      if (type === "movie") {
        url += `?id=${tmdbId}`;
      } else if (type === "show") {
        url += `?id=${tmdbId}&season=${season}&episode=${episode}`;
      }
      const res = await ctx2.proxiedFetcher(url, { headers: headers$2 });
      console.log(res);
      if (!Array.isArray(res) || res.length === 0) {
        throw new NotFoundError("No streams found");
      }
      const stream = res[0];
      if (!stream.url) {
        throw new NotFoundError("No file URL found in stream");
      }
      ctx2.progress(100);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(stream.url, stream.headers || headers$2),
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
  const madplayRoperEmbed = makeEmbed({
    id: "madplay-roper",
    name: "Roper",
    rank: 132,
    async scrape(ctx2) {
      const query = JSON.parse(ctx2.url);
      const { type, tmdbId, season, episode } = query;
      let url = `https://${baseUrl$d}/api/roper/`;
      if (type === "movie") {
        url += `?id=${tmdbId}&type=movie`;
      } else if (type === "show") {
        url += `?id=${tmdbId}&season=${season}&episode=${episode}&type=series`;
      }
      const res = await ctx2.proxiedFetcher(url, { headers: headers$2 });
      console.log(res);
      if (!Array.isArray(res) || res.length === 0) {
        throw new NotFoundError("No streams found");
      }
      const stream = res[0];
      if (!stream.url) {
        throw new NotFoundError("No file URL found in stream");
      }
      ctx2.progress(100);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(stream.url, stream.headers || headers$2),
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
  const madplayNsapiVidFastEmbed = makeEmbed({
    id: "madplay-vidfast",
    name: "Vidfast",
    rank: 131,
    async scrape(ctx2) {
      const query = JSON.parse(ctx2.url);
      const { type, tmdbId, season, episode } = query;
      let url = `https://${baseUrl$d}/api/nsapi/test?url=https://vidfast.pro/`;
      if (type === "movie") {
        url += `/movie/${tmdbId}`;
      } else if (type === "show") {
        url += `/tv/${tmdbId}/${season}/${episode}`;
      }
      const res = await ctx2.proxiedFetcher(url, { headers: headers$2 });
      console.log(res);
      if (!Array.isArray(res) || res.length === 0) {
        throw new NotFoundError("No streams found");
      }
      const stream = res[0];
      if (!stream.url) {
        throw new NotFoundError("No file URL found in stream");
      }
      ctx2.progress(100);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: createM3U8ProxyUrl(stream.url, stream.headers || headers$2),
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
  const providers$3 = [
    {
      id: "mp4hydra-1",
      name: "MP4Hydra Server 1",
      rank: 36
    },
    {
      id: "mp4hydra-2",
      name: "MP4Hydra Server 2",
      rank: 35,
      disabled: true
    }
  ];
  function embed$3(provider) {
    return makeEmbed({
      id: provider.id,
      name: provider.name,
      // disabled: provider.disabled,
      disabled: true,
      rank: provider.rank,
      async scrape(ctx2) {
        const [url, quality] = ctx2.url.split("|");
        return {
          stream: [
            {
              id: "primary",
              type: "file",
              qualities: {
                [getValidQualityFromString(quality || "")]: { url, type: "mp4" }
              },
              flags: [flags.CORS_ALLOWED],
              captions: []
            }
          ]
        };
      }
    });
  }
  const [mp4hydraServer1Scraper, mp4hydraServer2Scraper] = providers$3.map(embed$3);
  const myanimedubScraper = makeEmbed({
    id: "myanimedub",
    name: "MyAnime (Dub)",
    rank: 205,
    async scrape(ctx2) {
      var _a, _b, _c;
      const streamData = await ctx2.proxiedFetcher(
        `https://anime.aether.mom/api/stream?id=${ctx2.url}&server=HD-2&type=dub`
      );
      if (!((_b = (_a = streamData.results.streamingLink) == null ? void 0 : _a.link) == null ? void 0 : _b.file)) {
        throw new NotFoundError("No watchable sources found");
      }
      const getValidTimestamp = (timestamp) => {
        if (!timestamp || typeof timestamp !== "object") return null;
        const start = parseInt(timestamp.start, 10);
        const end = parseInt(timestamp.end, 10);
        if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || end <= 0 || start >= end) return null;
        return { start, end };
      };
      const intro = getValidTimestamp(streamData.results.streamingLink.intro);
      const outro = getValidTimestamp(streamData.results.streamingLink.outro);
      return {
        stream: [
          {
            id: "dub",
            type: "hls",
            playlist: createM3U8ProxyUrl(streamData.results.streamingLink.link.file, {
              Referer: "https://rapid-cloud.co/"
            }),
            flags: [flags.CORS_ALLOWED],
            captions: ((_c = streamData.results.streamingLink.tracks) == null ? void 0 : _c.map((track) => {
              const lang = labelToLanguageCode(track.label);
              const type = getCaptionTypeFromUrl(track.file);
              if (!lang || !type) return null;
              return {
                id: track.file,
                url: track.file,
                language: lang,
                type,
                hasCorsRestrictions: true
              };
            }).filter((x) => x)) ?? [],
            intro,
            outro
          }
        ]
      };
    }
  });
  const myanimesubScraper = makeEmbed({
    id: "myanimesub",
    name: "MyAnime (Sub)",
    rank: 204,
    async scrape(ctx2) {
      var _a, _b, _c;
      const streamData = await ctx2.proxiedFetcher(
        `https://anime.aether.mom/api/stream?id=${ctx2.url}&server=HD-2&type=sub`
      );
      if (!((_b = (_a = streamData.results.streamingLink) == null ? void 0 : _a.link) == null ? void 0 : _b.file)) {
        throw new NotFoundError("No watchable sources found");
      }
      const getValidTimestamp = (timestamp) => {
        if (!timestamp || typeof timestamp !== "object") return null;
        const start = parseInt(timestamp.start, 10);
        const end = parseInt(timestamp.end, 10);
        if (Number.isNaN(start) || Number.isNaN(end) || start <= 0 || end <= 0 || start >= end) return null;
        return { start, end };
      };
      const intro = getValidTimestamp(streamData.results.streamingLink.intro);
      const outro = getValidTimestamp(streamData.results.streamingLink.outro);
      return {
        stream: [
          {
            id: "sub",
            type: "hls",
            playlist: createM3U8ProxyUrl(streamData.results.streamingLink.link.file, {
              Referer: "https://rapid-cloud.co/"
            }),
            flags: [flags.CORS_ALLOWED],
            captions: ((_c = streamData.results.streamingLink.tracks) == null ? void 0 : _c.map((track) => {
              const lang = labelToLanguageCode(track.label);
              const type = getCaptionTypeFromUrl(track.file);
              if (!lang || !type) return null;
              return {
                id: track.file,
                url: track.file,
                language: lang,
                type,
                hasCorsRestrictions: true
              };
            }).filter((x) => x)) ?? [],
            intro,
            outro
          }
        ]
      };
    }
  });
  const referer = "https://ridomovies.tv/";
  const playlistHeaders = {
    referer: "https://ridoo.net/",
    origin: "https://ridoo.net"
  };
  const ridooScraper = makeEmbed({
    id: "ridoo",
    name: "Ridoo",
    rank: 121,
    async scrape(ctx2) {
      var _a;
      const res = await ctx2.proxiedFetcher(ctx2.url, {
        headers: {
          referer
        }
      });
      const regexPattern = /file:"([^"]+)"/g;
      const url = (_a = regexPattern.exec(res)) == null ? void 0 : _a[1];
      if (!url) throw new NotFoundError("Unable to find source url");
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            playlist: url,
            headers: playlistHeaders,
            captions: [],
            flags: [flags.CORS_ALLOWED]
          }
        ]
      };
    }
  });
  const providers$2 = [
    {
      id: "streamtape",
      name: "Streamtape",
      rank: 160
    },
    {
      id: "streamtape-latino",
      name: "Streamtape (Latino)",
      rank: 159
    }
  ];
  function embed$2(provider) {
    return makeEmbed({
      id: provider.id,
      name: provider.name,
      rank: provider.rank,
      async scrape(ctx2) {
        var _a;
        const embedHtml = await ctx2.proxiedFetcher(ctx2.url);
        const match2 = embedHtml.match(/robotlink'\).innerHTML = (.*)'/);
        if (!match2) throw new Error("No match found");
        const [fh, sh] = ((_a = match2 == null ? void 0 : match2[1]) == null ? void 0 : _a.split("+ ('")) ?? [];
        if (!fh || !sh) throw new Error("No match found");
        const url = `https:${fh == null ? void 0 : fh.replace(/'/g, "").trim()}${sh == null ? void 0 : sh.substring(3).trim()}`;
        return {
          stream: [
            {
              id: "primary",
              type: "file",
              flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
              captions: [],
              qualities: {
                unknown: {
                  type: "mp4",
                  url
                }
              },
              headers: {
                Referer: "https://streamtape.com"
              }
            }
          ]
        };
      }
    });
  }
  const [streamtapeScraper, streamtapeLatinoScraper] = providers$2.map(embed$2);
  const packedRegex = /(eval\(function\(p,a,c,k,e,d\).*\)\)\))/;
  const linkRegex = /src:"(https:\/\/[^"]+)"/;
  const streamvidScraper = makeEmbed({
    id: "streamvid",
    name: "Streamvid",
    rank: 215,
    async scrape(ctx2) {
      const streamRes = await ctx2.proxiedFetcher(ctx2.url);
      const packed = streamRes.match(packedRegex);
      if (!packed) throw new Error("streamvid packed not found");
      const unpacked = unpacker__namespace.unpack(packed[1]);
      const link = unpacked.match(linkRegex);
      if (!link) throw new Error("streamvid link not found");
      return {
        stream: [
          {
            type: "hls",
            id: "primary",
            playlist: link[1],
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
  class Unbaser {
    constructor(base) {
      __publicField(this, "ALPHABET", {
        62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
        95: "' !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'"
      });
      __publicField(this, "dictionary", {});
      __publicField(this, "base");
      __publicField(this, "unbase");
      this.base = base;
      if (base > 36 && base < 62) {
        this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substring(0, base);
      }
      if (base >= 2 && base <= 36) {
        this.unbase = (value) => parseInt(value, base);
      } else {
        try {
          [...this.ALPHABET[base]].forEach((cipher, index) => {
            this.dictionary[cipher] = index;
          });
        } catch {
          throw new Error("Unsupported base encoding.");
        }
        this.unbase = this._dictunbaser.bind(this);
      }
    }
    _dictunbaser(value) {
      let ret = 0;
      [...value].reverse().forEach((cipher, index) => {
        ret += this.base ** index * this.dictionary[cipher];
      });
      return ret;
    }
  }
  function _filterargs(code) {
    const juicers = [
      /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
      /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
    ];
    for (const juicer of juicers) {
      const args = juicer.exec(code);
      if (args) {
        try {
          return {
            payload: args[1],
            symtab: args[4].split("|"),
            radix: parseInt(args[2], 10),
            count: parseInt(args[3], 10)
          };
        } catch {
          throw new Error("Corrupted p.a.c.k.e.r. data.");
        }
      }
    }
    throw new Error("Could not make sense of p.a.c.k.e.r data (unexpected code structure)");
  }
  function _replacestrings(str) {
    return str;
  }
  function unpack(packedCode) {
    const { payload, symtab, radix, count } = _filterargs(packedCode);
    if (count !== symtab.length) {
      throw new Error("Malformed p.a.c.k.e.r. symtab.");
    }
    let unbase;
    try {
      unbase = new Unbaser(radix);
    } catch {
      throw new Error("Unknown p.a.c.k.e.r. encoding.");
    }
    const lookup = (match2) => {
      const word = match2;
      const word2 = radix === 1 ? symtab[parseInt(word, 10)] : symtab[unbase.unbase(word)];
      return word2 || word;
    };
    const replaced = payload.replace(/\b\w+\b/g, lookup);
    return _replacestrings(replaced);
  }
  const providers$1 = [
    {
      id: "streamwish-japanese",
      name: "StreamWish (Japanese Sub Español)",
      rank: 171
    },
    {
      id: "streamwish-latino",
      name: "streamwish (latino)",
      rank: 170
    },
    {
      id: "streamwish-spanish",
      name: "streamwish (castellano)",
      rank: 169
    },
    {
      id: "streamwish-english",
      name: "streamwish (english)",
      rank: 168
    }
  ];
  function embed$1(provider) {
    return makeEmbed({
      id: provider.id,
      name: provider.name,
      rank: provider.rank,
      async scrape(ctx2) {
        const headers2 = {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Encoding": "*",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0"
        };
        let html2;
        try {
          html2 = await ctx2.proxiedFetcher(ctx2.url, { headers: headers2 });
        } catch (error) {
          console.error(`Error details:`, {
            message: error instanceof Error ? error.message : "Unknown error",
            cause: error.cause || void 0,
            url: ctx2.url
          });
          throw error;
        }
        const obfuscatedScript = html2.match(/<script[^>]*>\s*(eval\(function\(p,a,c,k,e,d.*?\)[\s\S]*?)<\/script>/);
        if (!obfuscatedScript) {
          return { stream: [], embeds: [{ embedId: provider.id, url: ctx2.url }] };
        }
        let unpackedScript;
        try {
          unpackedScript = unpack(obfuscatedScript[1]);
        } catch {
          return { stream: [], embeds: [{ embedId: provider.id, url: ctx2.url }] };
        }
        const linkMatches = Array.from(unpackedScript.matchAll(/"(hls2|hls4)"\s*:\s*"([^"]*\.m3u8[^"]*)"/g));
        const links = linkMatches.map((match2) => ({ key: match2[1], url: match2[2] }));
        if (!links.length) {
          return { stream: [], embeds: [{ embedId: provider.id, url: ctx2.url }] };
        }
        let videoUrl = links[0].url;
        if (!/^https?:\/\//.test(videoUrl)) {
          videoUrl = `https://swiftplayers.com/${videoUrl.replace(/^\/+/g, "")}`;
        }
        try {
          const m3u8Content = await ctx2.proxiedFetcher(videoUrl, {
            headers: { Referer: ctx2.url }
          });
          const variants = Array.from(
            m3u8Content.matchAll(/#EXT-X-STREAM-INF:[^\n]+\n(?!iframe)([^\n]*index[^\n]*\.m3u8[^\n]*)/gi)
          );
          if (variants.length > 0) {
            const best = variants.find((v) => /#EXT-X-STREAM-INF/.test(v.input || "")) || variants[0];
            const base = videoUrl.substring(0, videoUrl.lastIndexOf("/") + 1);
            videoUrl = base + best[1];
          }
        } catch (error) {
        }
        const videoHeaders = {
          Referer: ctx2.url,
          Origin: ctx2.url
        };
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: createM3U8ProxyUrl(videoUrl, videoHeaders),
              flags: [flags.CORS_ALLOWED],
              captions: []
            }
          ],
          embeds: []
        };
      }
    });
  }
  const [streamwishLatinoScraper, streamwishSpanishScraper, streamwishEnglishScraper, streamwishJapaneseScraper] = providers$1.map(embed$1);
  const vidCloudScraper = makeEmbed({
    id: "vidcloud",
    name: "VidCloud",
    rank: 201,
    disabled: true,
    async scrape(ctx2) {
      const result = await upcloudScraper.scrape(ctx2);
      return {
        stream: result.stream.map((s) => ({
          ...s,
          flags: []
        }))
      };
    }
  });
  const VIDIFY_SERVERS = ["alfa", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett"];
  const baseUrl$c = "api.vidify.top";
  const playerUrl = "https://player.vidify.top/";
  let cachedAuthHeader = null;
  let lastFetched = 0;
  async function getAuthHeader(ctx2) {
    const now = Date.now();
    if (cachedAuthHeader && now - lastFetched < 1e3 * 60 * 60) {
      return cachedAuthHeader;
    }
    const playerPage = await ctx2.proxiedFetcher(playerUrl, {
      headers: {
        Referer: playerUrl
      }
    });
    const jsFileRegex = /\/assets\/index-([a-zA-Z0-9-]+)\.js/;
    const jsFileMatch = playerPage.match(jsFileRegex);
    if (!jsFileMatch) {
      throw new Error("Could not find the JS file URL in the player page");
    }
    const jsFileUrl = new URL(jsFileMatch[0], playerUrl).href;
    const jsContent = await ctx2.proxiedFetcher(jsFileUrl, {
      headers: {
        Referer: playerUrl
      }
    });
    const authRegex = /Authorization:"Bearer\s*([^"]+)"/;
    const authMatch = jsContent.match(authRegex);
    if (!authMatch || !authMatch[1]) {
      throw new Error("Could not extract the authorization header from the JS file");
    }
    cachedAuthHeader = `Bearer ${authMatch[1]}`;
    lastFetched = now;
    return cachedAuthHeader;
  }
  function makeVidifyEmbed(id, rank = 100) {
    const serverIndex = VIDIFY_SERVERS.indexOf(id) + 1;
    return makeEmbed({
      id: `vidify-${id}`,
      name: `${id.charAt(0).toUpperCase() + id.slice(1)}`,
      rank,
      disabled: true,
      async scrape(ctx2) {
        const query = JSON.parse(ctx2.url);
        const { type, tmdbId, season, episode } = query;
        let url = `https://${baseUrl$c}/`;
        if (type === "movie") {
          url += `/movie/${tmdbId}?sr=${serverIndex}`;
        } else if (type === "show") {
          url += `/tv/${tmdbId}/season/${season}/episode/${episode}?sr=${serverIndex}`;
        } else {
          throw new NotFoundError("Unsupported media type");
        }
        const authHeader = await getAuthHeader(ctx2);
        const headers2 = {
          referer: "https://player.vidify.top/",
          origin: "https://player.vidify.top",
          Authorization: authHeader,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        };
        const res = await ctx2.proxiedFetcher(url, { headers: headers2 });
        console.log(res);
        const playlistUrl = res.m3u8 ?? res.url;
        if (Array.isArray(res.result) && res.result.length > 0) {
          const qualities = {};
          res.result.forEach((r) => {
            if (r.url.includes(".mp4")) {
              qualities[`${r.resolution}p`] = { type: "mp4", url: decodeURIComponent(r.url) };
            }
          });
          if (Object.keys(qualities).length === 0) {
            throw new NotFoundError("No MP4 streams found");
          }
          console.log(`Found MP4 streams: `, qualities);
          return {
            stream: [
              {
                id: "primary",
                type: "file",
                qualities,
                flags: [],
                captions: [],
                headers: {
                  Host: "proxy-worker.himanshu464121.workers.dev"
                  // seems to be their only mp4 proxy
                }
              }
            ]
          };
        }
        if (!playlistUrl) throw new NotFoundError("No playlist URL found");
        const streamHeaders = { ...headers2 };
        let playlist;
        if (playlistUrl.includes("proxyv1.vidify.top")) {
          console.log(`Found stream (proxyv1): `, playlistUrl, streamHeaders);
          streamHeaders.Host = "proxyv1.vidify.top";
          playlist = decodeURIComponent(playlistUrl);
        } else if (playlistUrl.includes("proxyv2.vidify.top")) {
          console.log(`Found stream (proxyv2): `, playlistUrl, streamHeaders);
          streamHeaders.Host = "proxyv2.vidify.top";
          playlist = decodeURIComponent(playlistUrl);
        } else {
          console.log(`Found normal stream: `, playlistUrl);
          playlist = createM3U8ProxyUrl(decodeURIComponent(playlistUrl), streamHeaders);
        }
        ctx2.progress(100);
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist,
              headers: streamHeaders,
              flags: [],
              captions: []
            }
          ]
        };
      }
    });
  }
  const vidifyEmbeds = VIDIFY_SERVERS.map((server, i) => makeVidifyEmbed(server, 230 - i));
  const vidnestHollymoviehdEmbed = makeEmbed({
    id: "vidnest-hollymoviehd",
    name: "HollyMovie",
    rank: 104,
    async scrape(ctx2) {
      const serverStreams = await ctx2.proxiedFetcher(ctx2.url);
      if (!serverStreams.success || !serverStreams.sources) throw new NotFoundError("No streams found");
      const streams = [];
      for (const source of serverStreams.sources) {
        if (source.file.includes("pkaystream.cc/pl/")) {
          streams.push({
            id: `hollymoviehd-${source.label}`,
            type: "hls",
            playlist: createM3U8ProxyUrl(source.file),
            flags: [flags.CORS_ALLOWED],
            captions: []
          });
        }
      }
      return {
        stream: streams
      };
    }
  });
  const vidnestAllmoviesEmbed = makeEmbed({
    id: "vidnest-allmovies",
    name: "AllMovies (Hindi)",
    rank: 103,
    async scrape(ctx2) {
      const serverStreams = await ctx2.proxiedFetcher(ctx2.url);
      if (!serverStreams.streams) throw new NotFoundError("No streams found");
      const streams = [];
      for (const stream of serverStreams.streams) {
        streams.push({
          id: `allmovies-${stream.language}`,
          type: "hls",
          playlist: stream.url,
          flags: [flags.CORS_ALLOWED],
          captions: [],
          preferredHeaders: stream.headers
        });
      }
      return {
        stream: streams
      };
    }
  });
  const vidnestFlixhqEmbed = makeEmbed({
    id: "vidnest-flixhq",
    name: "FlixHQ",
    rank: 102,
    disabled: true,
    async scrape() {
      throw new Error("Not implemented");
    }
  });
  const vidnestOfficialEmbed = makeEmbed({
    id: "vidnest-official",
    name: "Official",
    rank: 101,
    disabled: true,
    async scrape() {
      throw new Error("Not implemented");
    }
  });
  const providers = [
    {
      id: "server-13",
      rank: 112
    },
    {
      id: "server-18",
      rank: 111
    },
    {
      id: "server-11",
      rank: 102
    },
    {
      id: "server-7",
      rank: 92
    },
    {
      id: "server-10",
      rank: 82
    },
    {
      id: "server-1",
      rank: 72
    },
    {
      id: "server-16",
      rank: 64
    },
    {
      id: "server-3",
      rank: 62
    },
    {
      id: "server-17",
      rank: 52
    },
    {
      id: "server-2",
      rank: 42
    },
    {
      id: "server-4",
      rank: 32
    },
    {
      id: "server-5",
      rank: 24
    },
    {
      id: "server-14",
      // catflix? uwu.m3u8
      rank: 22
    },
    {
      id: "server-6",
      rank: 21
    },
    {
      id: "server-15",
      rank: 20
    },
    {
      id: "server-8",
      rank: 19
    },
    {
      id: "server-9",
      rank: 18
    },
    {
      id: "server-19",
      rank: 17
    },
    {
      id: "server-12",
      rank: 16
    }
    // { // Looks like this was removed
    //   id: 'server-20',
    //   rank: 1,
    //   name: 'Cineby',
    // },
  ];
  function embed(provider) {
    return makeEmbed({
      id: provider.id,
      name: provider.name || provider.id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" "),
      // disabled: provider.disabled,
      disabled: true,
      rank: provider.rank,
      async scrape(ctx2) {
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: ctx2.url,
              flags: [flags.CORS_ALLOWED],
              captions: []
            }
          ]
        };
      }
    });
  }
  const [
    VidsrcsuServer1Scraper,
    VidsrcsuServer2Scraper,
    VidsrcsuServer3Scraper,
    VidsrcsuServer4Scraper,
    VidsrcsuServer5Scraper,
    VidsrcsuServer6Scraper,
    VidsrcsuServer7Scraper,
    VidsrcsuServer8Scraper,
    VidsrcsuServer9Scraper,
    VidsrcsuServer10Scraper,
    VidsrcsuServer11Scraper,
    VidsrcsuServer12Scraper,
    VidsrcsuServer20Scraper
  ] = providers.map(embed);
  const viperScraper = makeEmbed({
    id: "viper",
    name: "Viper",
    rank: 182,
    disabled: true,
    async scrape(ctx2) {
      const apiResponse = await ctx2.proxiedFetcher.full(ctx2.url, {
        headers: {
          Accept: "application/json",
          Referer: "https://embed.su/"
        }
      });
      if (!apiResponse.body.source) {
        throw new NotFoundError("No source found");
      }
      const playlistUrl = apiResponse.body.source.replace(/^.*\/viper\//, "https://");
      const headers2 = {
        referer: "https://megacloud.store/",
        origin: "https://megacloud.store"
      };
      return {
        stream: [
          {
            type: "hls",
            id: "primary",
            playlist: createM3U8ProxyUrl(playlistUrl, headers2),
            flags: [flags.CORS_ALLOWED],
            captions: []
          }
        ]
      };
    }
  });
  async function getVideowlUrlStream(ctx2, decryptedId) {
    var _a;
    const sharePage = await ctx2.proxiedFetcher("https://cloud.mail.ru/public/uaRH/2PYWcJRpH");
    const regex = /"videowl_view":\{"count":"(\d+)","url":"([^"]+)"\}/g;
    const videowlUrl = (_a = regex.exec(sharePage)) == null ? void 0 : _a[2];
    if (!videowlUrl) throw new NotFoundError("Failed to get videoOwlUrl");
    return `${videowlUrl}/0p/${btoa(decryptedId)}.m3u8?${new URLSearchParams({
      double_encode: "1"
    })}`;
  }
  const warezcdnembedHlsScraper = makeEmbed({
    id: "warezcdnembedhls",
    // WarezCDN is both a source and an embed host
    name: "WarezCDN HLS",
    // method no longer works
    disabled: true,
    rank: 83,
    async scrape(ctx2) {
      const decryptedId = await getDecryptedId(ctx2);
      if (!decryptedId) throw new NotFoundError("can't get file id");
      const streamUrl = await getVideowlUrlStream(ctx2, decryptedId);
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            flags: [flags.IP_LOCKED],
            captions: [],
            playlist: streamUrl
          }
        ]
      };
    }
  });
  const warezPlayerScraper = makeEmbed({
    id: "warezplayer",
    name: "warezPLAYER",
    disabled: true,
    rank: 85,
    async scrape(ctx2) {
      const playerPageUrl = new URL(ctx2.url);
      const hash = playerPageUrl.pathname.split("/")[2];
      const playerApiRes = await ctx2.proxiedFetcher("/player/index.php", {
        baseUrl: playerPageUrl.origin,
        query: {
          data: hash,
          do: "getVideo"
        },
        method: "POST",
        body: new URLSearchParams({
          hash
        }),
        headers: {
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      const sources = JSON.parse(playerApiRes);
      if (!sources.videoSource) throw new Error("Playlist not found");
      return {
        stream: [
          {
            id: "primary",
            type: "hls",
            flags: [],
            captions: [],
            playlist: sources.videoSource,
            headers: {
              // without this it returns "security error"
              Accept: "*/*"
            }
          }
        ]
      };
    }
  });
  const ZUNIME_SERVERS = ["hd-2", "miko", "shiro", "zaza"];
  const baseUrl$b = "https://backend.xaiby.sbs";
  const headers$1 = {
    referer: "https://vidnest.fun/",
    origin: "https://vidnest.fun",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };
  function makeZunimeEmbed(id, rank = 100) {
    return makeEmbed({
      id: `zunime-${id}`,
      name: `${id.charAt(0).toUpperCase() + id.slice(1)}`,
      rank,
      async scrape(ctx2) {
        var _a, _b;
        const serverName = id;
        const query = JSON.parse(ctx2.url);
        const { anilistId, episode } = query;
        const res = await ctx2.proxiedFetcher(`${"/sources"}`, {
          baseUrl: baseUrl$b,
          headers: headers$1,
          query: {
            id: String(anilistId),
            ep: String(episode ?? 1),
            host: serverName,
            type: "dub"
          }
        });
        console.log(res);
        const resAny = res;
        if (!(resAny == null ? void 0 : resAny.success) || !((_a = resAny == null ? void 0 : resAny.sources) == null ? void 0 : _a.url)) {
          throw new NotFoundError("No stream URL found in response");
        }
        const streamUrl = resAny.sources.url;
        const upstreamHeaders = ((_b = resAny == null ? void 0 : resAny.sources) == null ? void 0 : _b.headers) && Object.keys(resAny.sources.headers).length > 0 ? resAny.sources.headers : headers$1;
        ctx2.progress(100);
        return {
          stream: [
            {
              id: "primary",
              type: "hls",
              playlist: `https://proxy-2.madaraverse.online/proxy?url=${encodeURIComponent(streamUrl)}`,
              headers: upstreamHeaders,
              flags: [],
              captions: []
            }
          ]
        };
      }
    });
  }
  const zunimeEmbeds = ZUNIME_SERVERS.map((server, i) => makeZunimeEmbed(server, 260 - i));
  async function getStream$2(ctx2, id) {
    var _a, _b;
    try {
      const baseUrl3 = "https://ftmoh345xme.com";
      const headers2 = {
        Origin: "https://friness-cherlormur-i-275.site",
        Referer: "https://google.com/",
        Dnt: "1"
      };
      const url = `${baseUrl3}/play/${id}`;
      const result = await ctx2.proxiedFetcher(url, {
        headers: {
          ...headers2
        },
        method: "GET"
      });
      const $2 = cheerio__namespace.load(result);
      const script2 = $2("script").last().html();
      if (!script2) {
        throw new NotFoundError("Failed to extract script data");
      }
      const content = ((_a = script2.match(/(\{[^;]+});/)) == null ? void 0 : _a[1]) || ((_b = script2.match(/\((\{.*\})\)/)) == null ? void 0 : _b[1]);
      if (!content) {
        throw new NotFoundError("Media not found");
      }
      const data = JSON.parse(content);
      let file = data.file;
      if (!file) {
        throw new NotFoundError("File not found");
      }
      if (file.startsWith("/")) {
        file = baseUrl3 + file;
      }
      const key = data.key;
      const headers22 = {
        Origin: "https://friness-cherlormur-i-275.site",
        Referer: "https://google.com/",
        Dnt: "1",
        "X-Csrf-Token": key
      };
      const PlayListRes = await ctx2.proxiedFetcher(file, {
        headers: {
          ...headers22
        },
        method: "GET"
      });
      const playlist = PlayListRes;
      return {
        success: true,
        data: {
          playlist,
          key
        }
      };
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new NotFoundError("Failed to fetch media info");
    }
  }
  async function getStream$1(ctx2, file, key) {
    const f = file;
    const path = `${f.slice(1)}.txt`;
    try {
      const baseUrl3 = "https://ftmoh345xme.com";
      const headers2 = {
        Origin: "https://friness-cherlormur-i-275.site",
        Referer: "https://google.com/",
        Dnt: "1",
        "X-Csrf-Token": key
      };
      const url = `${baseUrl3}/playlist/${path}`;
      const result = await ctx2.proxiedFetcher(url, {
        headers: {
          ...headers2
        },
        method: "GET"
      });
      return {
        success: true,
        data: {
          link: result
        }
      };
    } catch (error) {
      throw new NotFoundError("Failed to fetch stream data");
    }
  }
  async function getMovie(ctx2, id, lang = "English") {
    var _a, _b;
    try {
      const mediaInfo = await getStream$2(ctx2, id);
      if (mediaInfo == null ? void 0 : mediaInfo.success) {
        const playlist = (_a = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _a.playlist;
        if (!playlist || !Array.isArray(playlist)) {
          throw new NotFoundError("Playlist not found or invalid");
        }
        let file = playlist.find((item) => (item == null ? void 0 : item.title) === lang);
        if (!file) {
          file = playlist == null ? void 0 : playlist[0];
        }
        if (!file) {
          throw new NotFoundError("No file found");
        }
        const availableLang = playlist.map((item) => item == null ? void 0 : item.title);
        const key = (_b = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _b.key;
        ctx2.progress(70);
        const streamUrl = await getStream$1(ctx2, file == null ? void 0 : file.file, key);
        if (streamUrl == null ? void 0 : streamUrl.success) {
          return { success: true, data: streamUrl == null ? void 0 : streamUrl.data, availableLang };
        }
        throw new NotFoundError("No stream url found");
      }
      throw new NotFoundError("No media info found");
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new NotFoundError("Failed to fetch movie data");
    }
  }
  async function getTV(ctx2, id, season, episode, lang) {
    var _a, _b, _c;
    try {
      const mediaInfo = await getStream$2(ctx2, id);
      if (!(mediaInfo == null ? void 0 : mediaInfo.success)) {
        throw new NotFoundError("No media info found");
      }
      const playlist = (_a = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _a.playlist;
      const getSeason = playlist.find((item) => (item == null ? void 0 : item.id) === season.toString());
      if (!getSeason) {
        throw new NotFoundError("No season found");
      }
      const getEpisode = getSeason == null ? void 0 : getSeason.folder.find((item) => (item == null ? void 0 : item.episode) === episode.toString());
      if (!getEpisode) {
        throw new NotFoundError("No episode found");
      }
      let file = getEpisode == null ? void 0 : getEpisode.folder.find((item) => (item == null ? void 0 : item.title) === lang);
      if (!file) {
        file = (_b = getEpisode == null ? void 0 : getEpisode.folder) == null ? void 0 : _b[0];
      }
      if (!file) {
        throw new NotFoundError("No file found");
      }
      const availableLang = getEpisode == null ? void 0 : getEpisode.folder.map((item) => {
        return item == null ? void 0 : item.title;
      });
      const filterLang = availableLang.filter((item) => (item == null ? void 0 : item.length) > 0);
      const key = (_c = mediaInfo == null ? void 0 : mediaInfo.data) == null ? void 0 : _c.key;
      ctx2.progress(70);
      const streamUrl = await getStream$1(ctx2, file == null ? void 0 : file.file, key);
      if (streamUrl == null ? void 0 : streamUrl.success) {
        return {
          success: true,
          data: streamUrl == null ? void 0 : streamUrl.data,
          availableLang: filterLang
        };
      }
      throw new NotFoundError("No stream url found");
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw new NotFoundError("Failed to fetch TV data");
    }
  }
  async function comboScraper$f(ctx2) {
    ({
      title: ctx2.media.title,
      releaseYear: ctx2.media.releaseYear,
      tmdbId: ctx2.media.tmdbId,
      imdbId: ctx2.media.imdbId,
      type: ctx2.media.type
    });
    if (ctx2.media.type === "show") {
      ctx2.media.season.number.toString();
      ctx2.media.episode.number.toString();
    }
    if (ctx2.media.type === "movie") {
      ctx2.progress(40);
      const res = await getMovie(ctx2, ctx2.media.imdbId);
      if (res == null ? void 0 : res.success) {
        ctx2.progress(90);
        return {
          embeds: [],
          stream: [
            {
              id: "primary",
              captions: [],
              playlist: res.data.link,
              type: "hls",
              flags: [flags.CORS_ALLOWED]
            }
          ]
        };
      }
      throw new NotFoundError("No providers available");
    }
    if (ctx2.media.type === "show") {
      ctx2.progress(40);
      const lang = "English";
      const res = await getTV(ctx2, ctx2.media.imdbId, ctx2.media.season.number, ctx2.media.episode.number, lang);
      if (res == null ? void 0 : res.success) {
        ctx2.progress(90);
        return {
          embeds: [],
          stream: [
            {
              id: "primary",
              captions: [],
              playlist: res.data.link,
              type: "hls",
              flags: [flags.CORS_ALLOWED]
            }
          ]
        };
      }
      throw new NotFoundError("No providers available");
    }
    throw new NotFoundError("No providers available");
  }
  const EightStreamScraper = makeSourcerer({
    id: "8stream",
    name: "8stream",
    rank: 111,
    flags: [],
    disabled: true,
    scrapeMovie: comboScraper$f,
    scrapeShow: comboScraper$f
  });
  const baseUrl$a = "https://www3.animeflv.net";
  async function searchAnimeFlv(ctx2, title) {
    const searchUrl = `${baseUrl$a}/browse?q=${encodeURIComponent(title)}`;
    const html2 = await ctx2.proxiedFetcher(searchUrl);
    const $2 = cheerio.load(html2);
    const results = $2("div.Container ul.ListAnimes li article");
    if (!results.length) throw new NotFoundError("No se encontró el anime en AnimeFLV");
    let animeUrl = "";
    results.each((_, el) => {
      const resultTitle = $2(el).find("a h3").text().trim().toLowerCase();
      if (resultTitle === title.trim().toLowerCase()) {
        animeUrl = $2(el).find("div.Description a.Button").attr("href") || "";
        return false;
      }
    });
    if (!animeUrl) {
      animeUrl = results.first().find("div.Description a.Button").attr("href") || "";
    }
    if (!animeUrl) throw new NotFoundError("No se encontró el anime en AnimeFLV");
    const fullUrl = animeUrl.startsWith("http") ? animeUrl : `${baseUrl$a}${animeUrl}`;
    return fullUrl;
  }
  async function getEpisodes(ctx2, animeUrl) {
    const html2 = await ctx2.proxiedFetcher(animeUrl);
    const $2 = cheerio.load(html2);
    let episodes = [];
    $2("script").each((_, script2) => {
      var _a, _b, _c;
      const data = $2(script2).html() || "";
      if (data.includes("var anime_info =")) {
        const animeInfo = (_a = data.split("var anime_info = [")[1]) == null ? void 0 : _a.split("];")[0];
        const animeUri = (_b = animeInfo == null ? void 0 : animeInfo.split(",")[2]) == null ? void 0 : _b.replace(/"/g, "").trim();
        const episodesRaw = (_c = data.split("var episodes = [")[1]) == null ? void 0 : _c.split("];")[0];
        if (animeUri && episodesRaw) {
          const arrEpisodes = episodesRaw.split("],[");
          episodes = arrEpisodes.map((arrEp) => {
            const noEpisode = arrEp.replace("[", "").replace("]", "").split(",")[0];
            return {
              number: parseInt(noEpisode, 10),
              url: `${baseUrl$a}/ver/${animeUri}-${noEpisode}`
            };
          });
        } else {
          console.log("[AnimeFLV] No se encontró animeUri o lista de episodios en el script");
        }
      }
    });
    if (episodes.length === 0) {
      console.log("[AnimeFLV] No se encontraron episodios");
    }
    return episodes;
  }
  async function getEmbeds$1(ctx, episodeUrl) {
    const html = await ctx.proxiedFetcher(episodeUrl);
    const $ = cheerio.load(html);
    const script = $('script:contains("var videos =")').html();
    if (!script) return {};
    const match = script.match(/var videos = (\{[\s\S]*?\});/);
    if (!match) return {};
    let videos = {};
    try {
      videos = eval(`(${match[1]})`);
    } catch {
      return {};
    }
    let streamwishJapanese;
    if (videos.SUB) {
      const sw = videos.SUB.find((s) => {
        var _a;
        return ((_a = s.title) == null ? void 0 : _a.toLowerCase()) === "sw";
      });
      if (sw && (sw.url || sw.code)) {
        streamwishJapanese = sw.url || sw.code;
        if (streamwishJapanese && streamwishJapanese.startsWith("/e/")) {
          streamwishJapanese = `https://streamwish.to${streamwishJapanese}`;
        }
      }
    }
    let streamtapeLatino;
    if (videos.LAT) {
      const stape = videos.LAT.find(
        (s) => {
          var _a, _b;
          return ((_a = s.title) == null ? void 0 : _a.toLowerCase()) === "stape" || ((_b = s.title) == null ? void 0 : _b.toLowerCase()) === "streamtape";
        }
      );
      if (stape && (stape.url || stape.code)) {
        streamtapeLatino = stape.url || stape.code;
        if (streamtapeLatino && streamtapeLatino.startsWith("/e/")) {
          streamtapeLatino = `https://streamtape.com${streamtapeLatino}`;
        }
      }
    }
    return {
      "streamwish-japanese": streamwishJapanese,
      "streamtape-latino": streamtapeLatino
    };
  }
  async function comboScraper$e(ctx2) {
    var _a;
    const title = ctx2.media.title;
    if (!title) throw new NotFoundError("Falta el título");
    console.log(`[AnimeFLV] Iniciando scraping para: ${title}`);
    const animeUrl = await searchAnimeFlv(ctx2, title);
    let episodeUrl2 = animeUrl;
    if (ctx2.media.type === "show") {
      const episode = (_a = ctx2.media.episode) == null ? void 0 : _a.number;
      if (!episode) throw new NotFoundError("Faltan datos de episodio");
      const episodes = await getEpisodes(ctx2, animeUrl);
      const ep = episodes.find((e) => e.number === episode);
      if (!ep) throw new NotFoundError(`No se encontró el episodio ${episode}`);
      episodeUrl2 = ep.url;
    } else if (ctx2.media.type === "movie") {
      const html2 = await ctx2.proxiedFetcher(animeUrl);
      const $2 = cheerio.load(html2);
      let animeUri = null;
      $2("script").each((_, script2) => {
        var _a2, _b;
        const data = $2(script2).html() || "";
        if (data.includes("var anime_info =")) {
          const animeInfo = (_a2 = data.split("var anime_info = [")[1]) == null ? void 0 : _a2.split("];")[0];
          animeUri = ((_b = animeInfo == null ? void 0 : animeInfo.split(",")[2]) == null ? void 0 : _b.replace(/"/g, "").trim()) || null;
        }
      });
      if (!animeUri) throw new NotFoundError("No se pudo obtener el animeUri para la película");
      episodeUrl2 = `${baseUrl$a}/ver/${animeUri}-1`;
    }
    const embedsObj = await getEmbeds$1(ctx2, episodeUrl2);
    const filteredEmbeds = Object.entries(embedsObj).filter(([, url]) => typeof url === "string" && !!url).map(([embedId, url]) => ({ embedId, url }));
    if (filteredEmbeds.length === 0) {
      throw new NotFoundError("No se encontraron streams válidos");
    }
    return { embeds: filteredEmbeds };
  }
  const animeflvScraper = makeSourcerer({
    id: "animeflv",
    name: "AnimeFLV",
    rank: 90,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeShow: comboScraper$e,
    scrapeMovie: comboScraper$e
  });
  const cache = /* @__PURE__ */ new Map();
  function normalizeTitle$1(t) {
    return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function matchesType(mediaType, anilist) {
    if (mediaType === "show") {
      return ["TV", "TV_SHORT", "OVA", "ONA", "SPECIAL"].includes(anilist.format);
    }
    return anilist.format === "MOVIE";
  }
  const anilistQuery = `
query ($search: String, $type: MediaType) {
  Page(page: 1, perPage: 20) {
    media(search: $search, type: $type, sort: POPULARITY_DESC) {
      id
      type
      format
      seasonYear
      title {
        romaji
        english
        native
      }
    }
  }
}
`;
  async function getAnilistIdFromMedia(ctx2, media) {
    var _a, _b, _c;
    const key = `${media.type}:${media.title}:${media.releaseYear}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const res = await ctx2.proxiedFetcher("", {
      baseUrl: "https://graphql.anilist.co",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        query: anilistQuery,
        variables: {
          search: media.title,
          type: "ANIME"
        }
      })
    });
    const items = ((_b = (_a = res.data) == null ? void 0 : _a.Page) == null ? void 0 : _b.media) ?? [];
    if (!items.length) {
      throw new Error("AniList id not found");
    }
    const targetTitle = normalizeTitle$1(media.title);
    const scored = items.filter((it) => matchesType(media.type, it)).map((it) => {
      const titles = [it.title.romaji];
      if (it.title.english) titles.push(it.title.english);
      if (it.title.native) titles.push(it.title.native);
      const normTitles = titles.map(normalizeTitle$1).filter(Boolean);
      const exact = normTitles.includes(targetTitle);
      const partial = normTitles.some((t) => t.includes(targetTitle) || targetTitle.includes(t));
      const yearDelta = it.seasonYear ? Math.abs(it.seasonYear - media.releaseYear) : 5;
      let score = 0;
      if (exact) score += 100;
      else if (partial) score += 50;
      score += Math.max(0, 20 - yearDelta * 4);
      return { it, score };
    }).sort((a, b) => b.score - a.score);
    const winner = ((_c = scored[0]) == null ? void 0 : _c.it) ?? items[0];
    const anilistId = winner == null ? void 0 : winner.id;
    if (!anilistId) throw new Error("AniList id not found");
    cache.set(key, anilistId);
    return anilistId;
  }
  async function comboScraper$d(ctx2) {
    const anilistId = await getAnilistIdFromMedia(ctx2, ctx2.media);
    const query = {
      type: ctx2.media.type,
      title: ctx2.media.title,
      tmdbId: ctx2.media.tmdbId,
      imdbId: ctx2.media.imdbId,
      anilistId,
      ...ctx2.media.type === "show" && {
        season: ctx2.media.season.number,
        episode: ctx2.media.episode.number
      },
      ...ctx2.media.type === "movie" && { episode: 1 },
      releaseYear: ctx2.media.releaseYear
    };
    return {
      embeds: [
        {
          embedId: "animetsu-pahe",
          url: JSON.stringify(query)
        },
        {
          embedId: "animetsu-zoro",
          url: JSON.stringify(query)
        },
        {
          embedId: "animetsu-zaza",
          url: JSON.stringify(query)
        },
        {
          embedId: "animetsu-meg",
          url: JSON.stringify(query)
        },
        {
          embedId: "animetsu-bato",
          url: JSON.stringify(query)
        }
      ]
    };
  }
  const animetsuScraper = makeSourcerer({
    id: "animetsu",
    name: "Animetsu",
    rank: 112,
    flags: [],
    scrapeShow: comboScraper$d
  });
  const CINEMAOS_SERVERS = [
    //   'flowcast',
    "shadow",
    "asiacloud",
    //   'hindicast',
    //   'anime',
    //   'animez',
    //   'guard',
    //   'hq',
    //   'ninja',
    //   'alpha',
    //   'kaze',
    //   'zenith',
    //   'cast',
    //   'ghost',
    //   'halo',
    //   'kinoecho',
    //   'ee3',
    //   'volt',
    //   'putafilme',
    "ophim"
    //   'kage',
  ];
  async function comboScraper$c(ctx2) {
    const embeds = [];
    const query = {
      type: ctx2.media.type,
      tmdbId: ctx2.media.tmdbId
    };
    if (ctx2.media.type === "show") {
      query.season = ctx2.media.season.number;
      query.episode = ctx2.media.episode.number;
    }
    for (const server of CINEMAOS_SERVERS) {
      embeds.push({
        embedId: `cinemaos-${server}`,
        url: JSON.stringify({ ...query, service: server })
      });
    }
    ctx2.progress(50);
    return { embeds };
  }
  const cinemaosScraper = makeSourcerer({
    id: "cinemaos",
    name: "CinemaOS",
    rank: 149,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$c,
    scrapeShow: comboScraper$c
  });
  const baseUrl$9 = "https://api.coitus.ca";
  async function comboScraper$b(ctx2) {
    const apiUrl2 = ctx2.media.type === "movie" ? `${baseUrl$9}/movie/${ctx2.media.tmdbId}` : `${baseUrl$9}/tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}`;
    const apiRes = await ctx2.proxiedFetcher(apiUrl2);
    if (!apiRes.videoSource) throw new NotFoundError("No watchable item found");
    let processedUrl = apiRes.videoSource;
    if (processedUrl.includes("orbitproxy")) {
      try {
        const urlParts = processedUrl.split(/orbitproxy\.[^/]+\//);
        if (urlParts.length >= 2) {
          const encryptedPart = urlParts[1].split(".m3u8")[0];
          try {
            const decodedData = Buffer.from(encryptedPart, "base64").toString("utf-8");
            const jsonData = JSON.parse(decodedData);
            const originalUrl = jsonData.u;
            const referer2 = jsonData.r || "";
            const headers2 = { referer: referer2 };
            processedUrl = createM3U8ProxyUrl(originalUrl, headers2);
          } catch (jsonError) {
            console.error("Error decoding/parsing orbitproxy data:", jsonError);
          }
        }
      } catch (error) {
        console.error("Error processing orbitproxy URL:", error);
      }
    }
    console.log(apiRes);
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          captions: [],
          playlist: processedUrl,
          type: "hls",
          flags: [flags.CORS_ALLOWED]
        }
      ]
    };
  }
  const coitusScraper = makeSourcerer({
    id: "coitus",
    name: "Autoembed+",
    rank: 91,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$b,
    scrapeShow: comboScraper$b
  });
  const baseUrl$8 = "https://www.cuevana3.eu";
  function normalizeTitle(title) {
    return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/gi, "").replace(/\s+/g, "-").replace(/-+/g, "-");
  }
  async function getStreamUrl(ctx2, embedUrl) {
    try {
      const html2 = await ctx2.proxiedFetcher(embedUrl);
      const match2 = html2.match(/var url = '([^']+)'/);
      if (match2) {
        return match2[1];
      }
    } catch {
    }
    return null;
  }
  function validateStream(url) {
    return url.startsWith("https://") && (url.includes("streamwish") || url.includes("filemoon") || url.includes("vidhide"));
  }
  async function extractVideos(ctx2, videos2) {
    const videoList = [];
    for (const [lang, videoArray] of Object.entries(videos2)) {
      if (!videoArray) continue;
      for (const video of videoArray) {
        if (!video.result) continue;
        const realUrl = await getStreamUrl(ctx2, video.result);
        if (!realUrl || !validateStream(realUrl)) continue;
        let embedId = "";
        if (realUrl.includes("filemoon")) embedId = "filemoon";
        else if (realUrl.includes("streamwish")) {
          if (lang === "latino") embedId = "streamwish-latino";
          else if (lang === "spanish") embedId = "streamwish-spanish";
          else if (lang === "english") embedId = "streamwish-english";
          else embedId = "streamwish-latino";
        } else if (realUrl.includes("vidhide")) embedId = "vidhide";
        else if (realUrl.includes("voe")) embedId = "voe";
        else continue;
        videoList.push({
          embedId,
          url: realUrl
        });
      }
    }
    return videoList;
  }
  async function fetchTmdbTitleInSpanish(tmdbId, apiKey, mediaType) {
    const endpoint = mediaType === "movie" ? `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=es-ES` : `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&language=es-ES`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Error fetching TMDB data: ${response.statusText}`);
    }
    const tmdbData = await response.json();
    return mediaType === "movie" ? tmdbData.title : tmdbData.name;
  }
  async function fetchTitleSubstitutes() {
    try {
      const response = await fetch("https://raw.githubusercontent.com/moonpic/fixed-titles/refs/heads/main/main.json");
      if (!response.ok) throw new Error("Failed to fetch fallback titles");
      return await response.json();
    } catch {
      return {};
    }
  }
  async function comboScraper$a(ctx2) {
    var _a, _b, _c, _d;
    const mediaType = ctx2.media.type;
    const tmdbId = ctx2.media.tmdbId;
    const apiKey = "7604525319adb2db8e7e841cb98e9217";
    if (!tmdbId) {
      throw new NotFoundError("TMDB ID is required to fetch the title in Spanish");
    }
    const translatedTitle = await fetchTmdbTitleInSpanish(Number(tmdbId), apiKey, mediaType);
    let normalizedTitle = normalizeTitle(translatedTitle);
    let pageUrl = mediaType === "movie" ? `${baseUrl$8}/ver-pelicula/${normalizedTitle}` : `${baseUrl$8}/episodio/${normalizedTitle}-temporada-${(_a = ctx2.media.season) == null ? void 0 : _a.number}-episodio-${(_b = ctx2.media.episode) == null ? void 0 : _b.number}`;
    ctx2.progress(60);
    let pageContent = await ctx2.proxiedFetcher(pageUrl);
    let $2 = cheerio.load(pageContent);
    let script2 = $2("script").toArray().find((scriptEl) => {
      var _a2;
      const content = ((_a2 = scriptEl.children[0]) == null ? void 0 : _a2.data) || "";
      return content.includes('{"props":{"pageProps":');
    });
    let embeds = [];
    if (script2) {
      let jsonData;
      try {
        const jsonString = script2.children[0].data;
        const start = jsonString.indexOf('{"props":{"pageProps":');
        if (start === -1) throw new Error("No valid JSON start found");
        const partialJson = jsonString.slice(start);
        jsonData = JSON.parse(partialJson);
      } catch (error) {
        throw new NotFoundError(`Failed to parse JSON: ${error.message}`);
      }
      if (mediaType === "movie") {
        const movieData = jsonData.props.pageProps.thisMovie;
        if (movieData == null ? void 0 : movieData.videos) {
          embeds = await extractVideos(ctx2, movieData.videos) ?? [];
        }
      } else {
        const episodeData = jsonData.props.pageProps.episode;
        if (episodeData == null ? void 0 : episodeData.videos) {
          embeds = await extractVideos(ctx2, episodeData.videos) ?? [];
        }
      }
    }
    if (embeds.length === 0) {
      const fallbacks = await fetchTitleSubstitutes();
      const fallbackTitle = fallbacks[tmdbId.toString()];
      if (!fallbackTitle) {
        throw new NotFoundError("No embed data found and no fallback title available");
      }
      normalizedTitle = normalizeTitle(fallbackTitle);
      pageUrl = mediaType === "movie" ? `${baseUrl$8}/ver-pelicula/${normalizedTitle}` : `${baseUrl$8}/episodio/${normalizedTitle}-temporada-${(_c = ctx2.media.season) == null ? void 0 : _c.number}-episodio-${(_d = ctx2.media.episode) == null ? void 0 : _d.number}`;
      pageContent = await ctx2.proxiedFetcher(pageUrl);
      $2 = cheerio.load(pageContent);
      script2 = $2("script").toArray().find((scriptEl) => {
        var _a2;
        const content = ((_a2 = scriptEl.children[0]) == null ? void 0 : _a2.data) || "";
        return content.includes('{"props":{"pageProps":');
      });
      if (script2) {
        let jsonData;
        try {
          const jsonString = script2.children[0].data;
          const start = jsonString.indexOf('{"props":{"pageProps":');
          if (start === -1) throw new Error("No valid JSON start found");
          const partialJson = jsonString.slice(start);
          jsonData = JSON.parse(partialJson);
        } catch (error) {
          throw new NotFoundError(`Failed to parse JSON: ${error.message}`);
        }
        if (mediaType === "movie") {
          const movieData = jsonData.props.pageProps.thisMovie;
          if (movieData == null ? void 0 : movieData.videos) {
            embeds = await extractVideos(ctx2, movieData.videos) ?? [];
          }
        } else {
          const episodeData = jsonData.props.pageProps.episode;
          if (episodeData == null ? void 0 : episodeData.videos) {
            embeds = await extractVideos(ctx2, episodeData.videos) ?? [];
          }
        }
      }
    }
    if (embeds.length === 0) {
      throw new NotFoundError("No valid streams found");
    }
    return { embeds };
  }
  const cuevana3Scraper = makeSourcerer({
    id: "cuevana3",
    name: "Cuevana3",
    rank: 80,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$a,
    scrapeShow: comboScraper$a
  });
  async function stringAtob(input) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    const str = input.replace(/=+$/, "");
    let output = "";
    if (str.length % 4 === 1) {
      throw new Error("The string to be decoded is not correctly encoded.");
    }
    for (let bc = 0, bs = 0, i = 0; i < str.length; i++) {
      const buffer = str.charAt(i);
      const charIndex = chars.indexOf(buffer);
      if (charIndex === -1) continue;
      bs = bc % 4 ? bs * 64 + charIndex : charIndex;
      if (bc++ % 4) {
        output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
      }
    }
    return output;
  }
  async function comboScraper$9(ctx2) {
    const embedUrl = `https://embed.su/embed/${ctx2.media.type === "movie" ? `movie/${ctx2.media.tmdbId}` : `tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}`}`;
    const embedPage = await ctx2.proxiedFetcher(embedUrl, {
      headers: {
        Referer: "https://embed.su/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    const vConfigMatch = embedPage.match(/window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+)/i);
    const encodedConfig = vConfigMatch == null ? void 0 : vConfigMatch[1];
    if (!encodedConfig) throw new NotFoundError("No encoded config found");
    const decodedConfig = JSON.parse(await stringAtob(encodedConfig));
    if (!(decodedConfig == null ? void 0 : decodedConfig.hash)) throw new NotFoundError("No stream hash found");
    const firstDecode = (await stringAtob(decodedConfig.hash)).split(".").map((item) => item.split("").reverse().join(""));
    const secondDecode = JSON.parse(await stringAtob(firstDecode.join("").split("").reverse().join("")));
    if (!(secondDecode == null ? void 0 : secondDecode.length)) throw new NotFoundError("No servers found");
    ctx2.progress(50);
    const embeds = secondDecode.map((server) => ({
      embedId: "viper",
      url: `https://embed.su/api/e/${server.hash}`
    }));
    ctx2.progress(90);
    return { embeds };
  }
  const embedsuScraper = makeSourcerer({
    id: "embedsu",
    name: "embed.su",
    rank: 165,
    disabled: true,
    flags: [],
    scrapeMovie: comboScraper$9,
    scrapeShow: comboScraper$9
  });
  function generateRandomFavs() {
    const randomHex = () => Math.floor(Math.random() * 16).toString(16);
    const generateSegment = (length) => Array.from({ length }, randomHex).join("");
    return `${generateSegment(8)}-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(
      12
    )}`;
  }
  function parseSubtitleLinks(inputString) {
    if (!inputString || typeof inputString === "boolean") return [];
    const linksArray = inputString.split(",");
    const captions = [];
    linksArray.forEach((link) => {
      const match2 = link.match(/\[([^\]]+)\](https?:\/\/\S+?)(?=,\[|$)/);
      if (match2) {
        const type = getCaptionTypeFromUrl(match2[2]);
        const language = labelToLanguageCode(match2[1]);
        if (!type || !language) return;
        captions.push({
          id: match2[2],
          language,
          hasCorsRestrictions: false,
          type,
          url: match2[2]
        });
      }
    });
    return captions;
  }
  function parseVideoLinks(inputString) {
    if (!inputString) throw new NotFoundError("No video links found");
    try {
      const qualityMap = {};
      const links = inputString.split(",");
      links.forEach((link) => {
        const match2 = link.match(/\[([^\]]+)\](https?:\/\/[^\s,]+)/);
        if (match2) {
          const [_, quality, url] = match2;
          if (url === "null") return;
          const normalizedQuality = quality.replace(/<[^>]+>/g, "").toLowerCase().replace("p", "").trim();
          qualityMap[normalizedQuality] = {
            type: "mp4",
            url: url.trim()
          };
        }
      });
      const result = {};
      Object.entries(qualityMap).forEach(([quality, data]) => {
        const validQuality = getValidQualityFromString(quality);
        result[validQuality] = data;
      });
      return result;
    } catch (error) {
      console.error("Error parsing video links:", error);
      throw new NotFoundError("Failed to parse video links");
    }
  }
  const rezkaBase = "https://hdrezka.ag/";
  const baseHeaders = {
    "X-Hdrezka-Android-App": "1",
    "X-Hdrezka-Android-App-Version": "2.2.0",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "CF-IPCountry": "RU"
  };
  async function searchAndFindMediaId(ctx2) {
    const searchData = await ctx2.proxiedFetcher(`/engine/ajax/search.php`, {
      baseUrl: rezkaBase,
      headers: baseHeaders,
      query: { q: ctx2.media.title }
    });
    const $2 = cheerio.load(searchData);
    const items = $2("a").map((_, el) => {
      var _a;
      const $el = $2(el);
      const url = $el.attr("href");
      const titleText = $el.find("span.enty").text();
      const yearMatch = titleText.match(/\((\d{4})\)/) || (url == null ? void 0 : url.match(/-(\d{4})(?:-|\.html)/)) || titleText.match(/(\d{4})/);
      const itemYear = yearMatch ? yearMatch[1] : null;
      const id = (_a = url == null ? void 0 : url.match(/\/(\d+)-[^/]+\.html$/)) == null ? void 0 : _a[1];
      if (id) {
        return {
          id,
          year: itemYear ? parseInt(itemYear, 10) : ctx2.media.releaseYear,
          type: ctx2.media.type,
          url: url || ""
        };
      }
      return null;
    }).get().filter(Boolean);
    items.sort((a, b) => {
      const diffA = Math.abs(a.year - ctx2.media.releaseYear);
      const diffB = Math.abs(b.year - ctx2.media.releaseYear);
      return diffA - diffB;
    });
    return items[0] || null;
  }
  async function getStream(id, translatorId, ctx2) {
    const searchParams = new URLSearchParams();
    searchParams.append("id", id);
    searchParams.append("translator_id", translatorId);
    if (ctx2.media.type === "show") {
      searchParams.append("season", ctx2.media.season.number.toString());
      searchParams.append("episode", ctx2.media.episode.number.toString());
    }
    searchParams.append("favs", generateRandomFavs());
    searchParams.append("action", ctx2.media.type === "show" ? "get_stream" : "get_movie");
    searchParams.append("t", Date.now().toString());
    const response = await ctx2.proxiedFetcher("/ajax/get_cdn_series/", {
      baseUrl: rezkaBase,
      method: "POST",
      body: searchParams,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${rezkaBase}films/action/${id}-novokain-2025-latest.html`
      }
    });
    try {
      const data = JSON.parse(response);
      if (!data.url && data.success) {
        throw new NotFoundError("Movie found but no stream available (might be premium or not yet released)");
      }
      if (!data.url) {
        throw new NotFoundError("No stream URL found in response");
      }
      return data;
    } catch (error) {
      console.error("Error parsing stream response:", error);
      throw new NotFoundError("Failed to parse stream response");
    }
  }
  async function getTranslatorId(url, id, ctx2) {
    const response = await ctx2.proxiedFetcher(url, {
      headers: baseHeaders
    });
    if (response.includes(`data-translator_id="238"`)) {
      return "238";
    }
    const functionName = ctx2.media.type === "movie" ? "initCDNMoviesEvents" : "initCDNSeriesEvents";
    const regexPattern = new RegExp(`sof\\.tv\\.${functionName}\\(${id}, ([^,]+)`, "i");
    const match2 = response.match(regexPattern);
    const translatorId = match2 ? match2[1] : null;
    return translatorId;
  }
  const universalScraper$6 = async (ctx2) => {
    const result = await searchAndFindMediaId(ctx2);
    if (!result || !result.id) throw new NotFoundError("No result found");
    const translatorId = await getTranslatorId(result.url, result.id, ctx2);
    if (!translatorId) throw new NotFoundError("No translator id found");
    const { url: streamUrl, subtitle: streamSubtitle } = await getStream(result.id, translatorId, ctx2);
    const parsedVideos = parseVideoLinks(streamUrl);
    const parsedSubtitles = parseSubtitleLinks(streamSubtitle);
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "file",
          flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
          captions: parsedSubtitles,
          qualities: parsedVideos
        }
      ]
    };
  };
  const hdRezkaScraper = makeSourcerer({
    id: "hdrezka",
    name: "HDRezka",
    rank: 100,
    flags: [flags.CORS_ALLOWED, flags.IP_LOCKED],
    scrapeShow: universalScraper$6,
    scrapeMovie: universalScraper$6
  });
  const baseUrl$7 = "https://iosmirror.cc";
  const baseUrl2$1 = "https://vercel-sucks.up.railway.app/iosmirror.cc:443";
  const universalScraper$5 = async (ctx2) => {
    var _a, _b, _c, _d, _e;
    const hash = decodeURIComponent(await ctx2.fetcher("https://iosmirror-hash.pstream.org/"));
    if (!hash) throw new NotFoundError("No hash found");
    ctx2.progress(10);
    const searchRes = await ctx2.proxiedFetcher("/search.php", {
      baseUrl: baseUrl2$1,
      query: { s: ctx2.media.title },
      headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
    });
    if (searchRes.status !== "y" || !searchRes.searchResult) throw new NotFoundError(searchRes.error);
    async function getMeta(id2) {
      return ctx2.proxiedFetcher("/post.php", {
        baseUrl: baseUrl2$1,
        query: { id: id2 },
        headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
      });
    }
    ctx2.progress(30);
    let metaRes;
    let id = (_a = searchRes.searchResult.find(async (x) => {
      metaRes = await getMeta(x.id);
      return compareTitle(x.t, ctx2.media.title) && (Number(metaRes.year) === ctx2.media.releaseYear || metaRes.type === (ctx2.media.type === "movie" ? "m" : "t"));
    })) == null ? void 0 : _a.id;
    if (!id) throw new NotFoundError("No watchable item found");
    if (ctx2.media.type === "show") {
      metaRes = await getMeta(id);
      const showMedia = ctx2.media;
      const seasonId = (_b = metaRes == null ? void 0 : metaRes.season.find((x) => Number(x.s) === showMedia.season.number)) == null ? void 0 : _b.id;
      if (!seasonId) throw new NotFoundError("Season not available");
      const episodeRes = await ctx2.proxiedFetcher("/episodes.php", {
        baseUrl: baseUrl2$1,
        query: { s: seasonId, series: id },
        headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
      });
      let episodes = [...episodeRes.episodes];
      let currentPage = 2;
      while (episodeRes.nextPageShow === 1) {
        const nextPageRes = await ctx2.proxiedFetcher("/episodes.php", {
          baseUrl: baseUrl2$1,
          query: { s: seasonId, series: id, page: currentPage.toString() },
          headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
        });
        episodes = [...episodes, ...nextPageRes.episodes];
        episodeRes.nextPageShow = nextPageRes.nextPageShow;
        currentPage++;
      }
      const episodeId = (_c = episodes.find(
        (x) => x.ep === `E${showMedia.episode.number}` && x.s === `S${showMedia.season.number}`
      )) == null ? void 0 : _c.id;
      if (!episodeId) throw new NotFoundError("Episode not available");
      id = episodeId;
    }
    const playlistRes = await ctx2.proxiedFetcher("/playlist.php?", {
      baseUrl: baseUrl2$1,
      query: { id },
      headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
    });
    ctx2.progress(50);
    let autoFile = (_d = playlistRes[0].sources.find((source) => source.label === "Auto")) == null ? void 0 : _d.file;
    if (!autoFile) {
      autoFile = (_e = playlistRes[0].sources.find((source) => source.label === "Full HD")) == null ? void 0 : _e.file;
    }
    if (!autoFile) {
      console.log('"Full HD" or "Auto" file not found, falling back to first source');
      autoFile = playlistRes[0].sources[0].file;
    }
    if (!autoFile) throw new Error("Failed to fetch playlist");
    const headers2 = {
      referer: baseUrl$7,
      cookie: makeCookieHeader({ hd: "on" })
    };
    const playlist = createM3U8ProxyUrl(`${baseUrl$7}${autoFile}`, headers2);
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          playlist,
          type: "hls",
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  };
  const iosmirrorScraper = makeSourcerer({
    id: "iosmirror",
    name: "NetMirror",
    rank: 182,
    // disabled: !!isIos,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: universalScraper$5,
    scrapeShow: universalScraper$5
  });
  const baseUrl$6 = "https://iosmirror.cc";
  const baseUrl2 = "https://vercel-sucks.up.railway.app/iosmirror.cc:443/pv";
  const universalScraper$4 = async (ctx2) => {
    var _a, _b, _c, _d, _e;
    const hash = decodeURIComponent(await ctx2.fetcher("https://iosmirror-hash.pstream.org/"));
    if (!hash) throw new NotFoundError("No hash found");
    ctx2.progress(10);
    const searchRes = await ctx2.proxiedFetcher("/search.php", {
      baseUrl: baseUrl2,
      query: { s: ctx2.media.title },
      headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
    });
    if (!searchRes.searchResult) throw new NotFoundError(searchRes.error);
    async function getMeta(id2) {
      return ctx2.proxiedFetcher("/post.php", {
        baseUrl: baseUrl2,
        query: { id: id2 },
        headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
      });
    }
    ctx2.progress(30);
    let id = (_a = searchRes.searchResult.find(async (x) => {
      const metaRes = await getMeta(x.id);
      return compareTitle(x.t, ctx2.media.title) && (Number(x.y) === ctx2.media.releaseYear || metaRes.type === (ctx2.media.type === "movie" ? "m" : "t"));
    })) == null ? void 0 : _a.id;
    if (!id) throw new NotFoundError("No watchable item found");
    if (ctx2.media.type === "show") {
      const metaRes = await getMeta(id);
      const showMedia = ctx2.media;
      const seasonId = (_b = metaRes == null ? void 0 : metaRes.season.find((x) => Number(x.s) === showMedia.season.number)) == null ? void 0 : _b.id;
      if (!seasonId) throw new NotFoundError("Season not available");
      const episodeRes = await ctx2.proxiedFetcher("/episodes.php", {
        baseUrl: baseUrl2,
        query: { s: seasonId, series: id },
        headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
      });
      let episodes = [...episodeRes.episodes];
      let currentPage = 2;
      while (episodeRes.nextPageShow === 1) {
        const nextPageRes = await ctx2.proxiedFetcher("/episodes.php", {
          baseUrl: baseUrl2,
          query: { s: seasonId, series: id, page: currentPage.toString() },
          headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
        });
        episodes = [...episodes, ...nextPageRes.episodes];
        episodeRes.nextPageShow = nextPageRes.nextPageShow;
        currentPage++;
      }
      const episodeId = (_c = episodes.find(
        (x) => x.ep === `E${showMedia.episode.number}` && x.s === `S${showMedia.season.number}`
      )) == null ? void 0 : _c.id;
      if (!episodeId) throw new NotFoundError("Episode not available");
      id = episodeId;
    }
    const playlistRes = await ctx2.proxiedFetcher("/playlist.php?", {
      baseUrl: baseUrl2,
      query: { id },
      headers: { cookie: makeCookieHeader({ t_hash_t: hash, hd: "on" }) }
    });
    ctx2.progress(50);
    let autoFile = (_d = playlistRes[0].sources.find((source) => source.label === "Auto")) == null ? void 0 : _d.file;
    if (!autoFile) {
      autoFile = (_e = playlistRes[0].sources.find((source) => source.label === "Full HD")) == null ? void 0 : _e.file;
    }
    if (!autoFile) {
      console.log('"Full HD" or "Auto" file not found, falling back to first source');
      autoFile = playlistRes[0].sources[0].file;
    }
    if (!autoFile) throw new Error("Failed to fetch playlist");
    const headers2 = {
      referer: baseUrl$6,
      cookie: makeCookieHeader({ hd: "on" })
    };
    const playlist = createM3U8ProxyUrl(`${baseUrl$6}${autoFile}`, headers2);
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          playlist,
          type: "hls",
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  };
  const iosmirrorPVScraper = makeSourcerer({
    id: "iosmirrorpv",
    name: "PrimeMirror",
    rank: 183,
    // disabled: !!isIos,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: universalScraper$4,
    scrapeShow: universalScraper$4
  });
  async function getVideoSources(ctx2, id, media) {
    let path = "";
    if (media.type === "show") {
      path = `/v1/episodes/view`;
    } else if (media.type === "movie") {
      path = `/v1/movies/view`;
    }
    const data = await ctx2.proxiedFetcher(path, {
      baseUrl: baseUrl$5,
      query: { expand: "streams,subtitles", id }
    });
    return data;
  }
  async function getVideo(ctx2, id, media) {
    const data = await getVideoSources(ctx2, id, media);
    const videoSources = data.streams;
    const opts = ["auto", "1080p", "1080", "720p", "720", "480p", "480", "240p", "240", "360p", "360", "144", "144p"];
    let videoUrl = null;
    for (const res of opts) {
      if (videoSources[res] && !videoUrl) {
        videoUrl = videoSources[res];
      }
    }
    let captions = [];
    for (const sub of data.subtitles) {
      const language = labelToLanguageCode(sub.language);
      if (!language) continue;
      captions.push({
        id: sub.url,
        type: "vtt",
        url: `${baseUrl$5}${sub.url}`,
        hasCorsRestrictions: false,
        language
      });
    }
    captions = removeDuplicatedLanguages(captions);
    return {
      playlist: videoUrl,
      captions
    };
  }
  const baseUrl$5 = "https://lmscript.xyz";
  async function searchAndFindMedia(ctx2, media) {
    if (media.type === "show") {
      const searchRes = await ctx2.proxiedFetcher(`/v1/shows`, {
        baseUrl: baseUrl$5,
        query: { "filters[q]": media.title }
      });
      const results = searchRes.items;
      const result = results.find((res) => compareMedia(media, res.title, Number(res.year)));
      return result;
    }
    if (media.type === "movie") {
      const searchRes = await ctx2.proxiedFetcher(`/v1/movies`, {
        baseUrl: baseUrl$5,
        query: { "filters[q]": media.title }
      });
      const results = searchRes.items;
      const result = results.find((res) => compareMedia(media, res.title, Number(res.year)));
      return result;
    }
  }
  async function scrape$1(ctx2, media, result) {
    var _a;
    let id = null;
    if (media.type === "movie") {
      id = result.id_movie;
    } else if (media.type === "show") {
      const data = await ctx2.proxiedFetcher(`/v1/shows`, {
        baseUrl: baseUrl$5,
        query: { expand: "episodes", id: result.id_show }
      });
      const episode = (_a = data.episodes) == null ? void 0 : _a.find((v) => {
        return Number(v.season) === Number(media.season.number) && Number(v.episode) === Number(media.episode.number);
      });
      if (episode) id = episode.id;
    }
    if (id === null) throw new NotFoundError("Not found");
    const video = await getVideo(ctx2, id, media);
    return video;
  }
  async function universalScraper$3(ctx2) {
    const lookmovieData = await searchAndFindMedia(ctx2, ctx2.media);
    if (!lookmovieData) throw new NotFoundError("Media not found");
    ctx2.progress(30);
    const video = await scrape$1(ctx2, ctx2.media, lookmovieData);
    if (!video.playlist) throw new NotFoundError("No video found");
    ctx2.progress(60);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          playlist: video.playlist,
          type: "hls",
          flags: [flags.IP_LOCKED],
          captions: video.captions
        }
      ]
    };
  }
  const lookmovieScraper = makeSourcerer({
    id: "lookmovie",
    name: "LookMovie",
    disabled: false,
    rank: 140,
    flags: [flags.IP_LOCKED],
    scrapeShow: universalScraper$3,
    scrapeMovie: universalScraper$3
  });
  async function comboScraper$8(ctx2) {
    const query = {
      type: ctx2.media.type,
      title: ctx2.media.title,
      tmdbId: ctx2.media.tmdbId,
      imdbId: ctx2.media.imdbId,
      ...ctx2.media.type === "show" && {
        season: ctx2.media.season.number,
        episode: ctx2.media.episode.number
      },
      releaseYear: ctx2.media.releaseYear
    };
    return {
      embeds: [
        {
          embedId: "madplay-base",
          url: JSON.stringify(query)
        },
        {
          embedId: "madplay-nsapi",
          url: JSON.stringify(query)
        },
        {
          embedId: "madplay-roper",
          url: JSON.stringify(query)
        },
        {
          embedId: "madplay-vidfast",
          url: JSON.stringify(query)
        }
      ]
    };
  }
  const madplayScraper = makeSourcerer({
    id: "madplay",
    name: "Flicky",
    rank: 155,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$8,
    scrapeShow: comboScraper$8
  });
  const levenshtein = (s, t) => {
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    const arr = [];
    for (let i = 0; i <= t.length; i++) {
      arr[i] = [i];
      for (let j = 1; j <= s.length; j++) {
        arr[i][j] = i === 0 ? j : Math.min(arr[i - 1][j] + 1, arr[i][j - 1] + 1, arr[i - 1][j - 1] + (s[j - 1] === t[i - 1] ? 0 : 1));
      }
    }
    return arr[t.length][s.length];
  };
  const universalScraper$2 = async (ctx2) => {
    const searchResults = await ctx2.proxiedFetcher(
      `https://anime-api-cyan-zeta.vercel.app/api/search?keyword=${encodeURIComponent(ctx2.media.title)}`
    );
    const bestMatch = searchResults.results.data.map((item) => {
      const similarity = 1 - levenshtein(item.title, ctx2.media.title) / Math.max(item.title.length, ctx2.media.title.length);
      const isExactMatch = compareTitle(item.title, ctx2.media.title);
      return { ...item, similarity, isExactMatch };
    }).sort((a, b) => {
      if (a.isExactMatch && !b.isExactMatch) return -1;
      if (!a.isExactMatch && b.isExactMatch) return 1;
      return b.similarity - a.similarity;
    })[0];
    if (!bestMatch) {
      throw new NotFoundError("No watchable sources found");
    }
    const episodeData = await ctx2.proxiedFetcher(`https://anime.aether.mom/api/episodes/${bestMatch.id}`);
    const episode = episodeData.results.episodes.find(
      (e) => e.episode_no === (ctx2.media.type === "show" ? ctx2.media.episode.number : 1)
    );
    if (!episode) {
      throw new NotFoundError("No watchable sources found");
    }
    return {
      embeds: [
        {
          embedId: "myanimesub",
          url: episode.id
        },
        {
          embedId: "myanimedub",
          url: episode.id
        }
      ]
    };
  };
  const myanimeScraper = makeSourcerer({
    id: "myanime",
    name: "MyAnime",
    rank: 101,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: universalScraper$2,
    scrapeShow: universalScraper$2
  });
  const mamaApiBase = "https://mama.up.railway.app/api/showbox";
  const getUserToken = () => {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem("febbox_ui_token") : null;
    } catch (e) {
      console.warn("Unable to access localStorage:", e);
      return null;
    }
  };
  async function comboScraper$7(ctx2) {
    const userToken = getUserToken();
    const apiUrl2 = ctx2.media.type === "movie" ? `${mamaApiBase}/movie/${ctx2.media.tmdbId}?token=${userToken}` : `${mamaApiBase}/tv/${ctx2.media.tmdbId}?season=${ctx2.media.season.number}&episode=${ctx2.media.episode.number}&token=${userToken}`;
    const apiRes = await ctx2.proxiedFetcher(apiUrl2);
    if (!apiRes) {
      throw new NotFoundError("No response from API");
    }
    const data = await apiRes;
    if (!data.success) {
      throw new NotFoundError("No streams found");
    }
    const streamItems = Array.isArray(data.streams) ? data.streams : [data.streams];
    if (streamItems.length === 0 || !streamItems[0].player_streams) {
      throw new NotFoundError("No valid streams found");
    }
    let bestStreamItem = streamItems[0];
    for (const item of streamItems) {
      if (item.quality.includes("4K") || item.quality.includes("2160p")) {
        bestStreamItem = item;
        break;
      }
    }
    const streams = bestStreamItem.player_streams.reduce((acc, stream) => {
      let qualityKey;
      if (stream.quality === "4K" || stream.quality.includes("4K")) {
        qualityKey = 2160;
      } else if (stream.quality === "ORG" || stream.quality.includes("ORG")) {
        return acc;
      } else {
        qualityKey = parseInt(stream.quality.replace("P", ""), 10);
      }
      if (Number.isNaN(qualityKey) || acc[qualityKey]) return acc;
      acc[qualityKey] = stream.file;
      return acc;
    }, {});
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          captions: [],
          qualities: {
            ...streams[2160] && {
              "4k": {
                type: "mp4",
                url: streams[2160]
              }
            },
            ...streams[1080] && {
              1080: {
                type: "mp4",
                url: streams[1080]
              }
            },
            ...streams[720] && {
              720: {
                type: "mp4",
                url: streams[720]
              }
            },
            ...streams[480] && {
              480: {
                type: "mp4",
                url: streams[480]
              }
            },
            ...streams[360] && {
              360: {
                type: "mp4",
                url: streams[360]
              }
            }
          },
          type: "file",
          flags: [flags.CORS_ALLOWED]
        }
      ]
    };
  }
  const nunflixScraper = makeSourcerer({
    id: "nunflix",
    name: "NFlix",
    rank: 155,
    disabled: !getUserToken(),
    // disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$7,
    scrapeShow: comboScraper$7
  });
  const baseUrl$4 = "api.rgshows.me";
  const headers = {
    referer: "https://rgshows.me/",
    origin: "https://rgshows.me",
    host: baseUrl$4,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };
  async function comboScraper$6(ctx2) {
    var _a;
    let url = `https://${baseUrl$4}/main`;
    if (ctx2.media.type === "movie") {
      url += `/movie/${ctx2.media.tmdbId}`;
    } else if (ctx2.media.type === "show") {
      url += `/tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}`;
    }
    const res = await ctx2.proxiedFetcher(url, { headers });
    if (!((_a = res == null ? void 0 : res.stream) == null ? void 0 : _a.url)) {
      throw new NotFoundError("No streams found");
    }
    if (res.stream.url === "https://vidzee.wtf/playlist/69/master.m3u8") {
      throw new NotFoundError("Found only vidzee porn stream");
    }
    const streamUrl = res.stream.url;
    const streamHost = new URL(streamUrl).host;
    const m3u8Headers = {
      ...headers,
      host: streamHost,
      origin: "https://www.rgshows.me",
      referer: "https://www.rgshows.me/"
    };
    ctx2.progress(100);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: streamUrl,
          headers: m3u8Headers,
          flags: [],
          captions: []
        }
      ]
    };
  }
  const rgshowsScraper = makeSourcerer({
    id: "rgshows",
    name: "RGShows",
    rank: 173,
    flags: [],
    scrapeMovie: comboScraper$6,
    scrapeShow: comboScraper$6
  });
  const ridoMoviesBase = `https://ridomovies.tv`;
  const ridoMoviesApiBase = `${ridoMoviesBase}/core/api`;
  const universalScraper$1 = async (ctx2) => {
    const searchResult = await ctx2.proxiedFetcher("/search", {
      baseUrl: ridoMoviesApiBase,
      query: {
        q: ctx2.media.title
      }
    });
    const mediaData = searchResult.data.items.map((movieEl) => {
      const name = movieEl.title;
      const year = movieEl.contentable.releaseYear;
      const fullSlug = movieEl.fullSlug;
      return { name, year, fullSlug };
    });
    const targetMedia = mediaData.find((m) => m.name === ctx2.media.title && m.year === ctx2.media.releaseYear.toString());
    if (!(targetMedia == null ? void 0 : targetMedia.fullSlug)) throw new NotFoundError("No watchable item found");
    ctx2.progress(40);
    let iframeSourceUrl = `/${targetMedia.fullSlug}/videos`;
    if (ctx2.media.type === "show") {
      const showPageResult = await ctx2.proxiedFetcher(`/${targetMedia.fullSlug}`, {
        baseUrl: ridoMoviesBase
      });
      const fullEpisodeSlug = `season-${ctx2.media.season.number}/episode-${ctx2.media.episode.number}`;
      const regexPattern = new RegExp(
        `\\\\"id\\\\":\\\\"(\\d+)\\\\"(?=.*?\\\\\\"fullSlug\\\\\\":\\\\\\"[^"]*${fullEpisodeSlug}[^"]*\\\\\\")`,
        "g"
      );
      const matches = [...showPageResult.matchAll(regexPattern)];
      const episodeIds = matches.map((match2) => match2[1]);
      if (episodeIds.length === 0) throw new NotFoundError("No watchable item found");
      const episodeId = episodeIds.at(-1);
      iframeSourceUrl = `/episodes/${episodeId}/videos`;
    }
    const iframeSource = await ctx2.proxiedFetcher(iframeSourceUrl, {
      baseUrl: ridoMoviesApiBase
    });
    const iframeSource$ = cheerio.load(iframeSource.data[0].url);
    const iframeUrl = iframeSource$("iframe").attr("data-src");
    if (!iframeUrl) throw new NotFoundError("No watchable item found");
    ctx2.progress(60);
    const embeds = [];
    if (iframeUrl.includes("closeload")) {
      embeds.push({
        embedId: closeLoadScraper.id,
        url: iframeUrl
      });
    }
    if (iframeUrl.includes("ridoo")) {
      embeds.push({
        embedId: ridooScraper.id,
        url: iframeUrl
      });
    }
    ctx2.progress(90);
    return {
      embeds
    };
  };
  const ridooMoviesScraper = makeSourcerer({
    id: "ridomovies",
    name: "RidoMovies",
    rank: 210,
    flags: [],
    disabled: false,
    scrapeMovie: universalScraper$1,
    scrapeShow: universalScraper$1
  });
  const baseUrl$3 = "https://pupp.slidemovies-dev.workers.dev";
  async function comboScraper$5(ctx2) {
    const watchPageUrl = ctx2.media.type === "movie" ? `${baseUrl$3}/movie/${ctx2.media.tmdbId}` : `${baseUrl$3}/tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/-${ctx2.media.episode.number}`;
    const watchPage = await ctx2.proxiedFetcher(watchPageUrl);
    const $2 = cheerio.load(watchPage);
    ctx2.progress(50);
    const proxiedStreamUrl = $2("media-player").attr("src");
    if (!proxiedStreamUrl) {
      throw new NotFoundError("Stream URL not found");
    }
    const proxyUrl = new URL(proxiedStreamUrl);
    const encodedUrl = proxyUrl.searchParams.get("url") || "";
    const playlist = decodeURIComponent(encodedUrl);
    const captions = $2("media-provider track").map((_, el) => {
      const url = $2(el).attr("src") || "";
      const rawLang = $2(el).attr("lang") || "unknown";
      const languageCode = labelToLanguageCode(rawLang) || rawLang;
      const isVtt = url.endsWith(".vtt") ? "vtt" : "srt";
      return {
        type: isVtt,
        id: url,
        url,
        language: languageCode,
        hasCorsRestrictions: false
      };
    }).get();
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "hls",
          flags: [],
          playlist,
          captions
        }
      ]
    };
  }
  const slidemoviesScraper = makeSourcerer({
    id: "slidemovies",
    name: "SlideMovies",
    rank: 135,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$5,
    scrapeShow: comboScraper$5
  });
  async function convertPlaylistsToDataUrls(fetcher, playlistUrl, headers2) {
    const playlistData = await fetcher(playlistUrl, { headers: headers2 });
    const playlist = hlsParser.parse(playlistData);
    if (playlist.isMasterPlaylist) {
      const baseUrl3 = new URL(playlistUrl).origin;
      await Promise.all(
        playlist.variants.map(async (variant) => {
          let variantUrl = variant.uri;
          if (!variantUrl.startsWith("http")) {
            if (!variantUrl.startsWith("/")) {
              variantUrl = `/${variantUrl}`;
            }
            variantUrl = baseUrl3 + variantUrl;
          }
          const variantPlaylistData = await fetcher(variantUrl, { headers: headers2 });
          const variantPlaylist = hlsParser.parse(variantPlaylistData);
          variant.uri = `data:application/vnd.apple.mpegurl;base64,${btoa(hlsParser.stringify(variantPlaylist))}`;
        })
      );
    }
    return `data:application/vnd.apple.mpegurl;base64,${btoa(hlsParser.stringify(playlist))}`;
  }
  const baseUrl$2 = "https://soaper.cc";
  const universalScraper = async (ctx2) => {
    var _a;
    const searchResult = await ctx2.proxiedFetcher("/search.html", {
      baseUrl: baseUrl$2,
      query: {
        keyword: ctx2.media.title
      }
    });
    const search$ = cheerio.load(searchResult);
    const searchResults = [];
    search$(".thumbnail").each((_, element) => {
      const title = search$(element).find("h5").find("a").first().text().trim();
      const year = search$(element).find(".img-tip").first().text().trim();
      const url = search$(element).find("h5").find("a").first().attr("href");
      if (!title || !url) return;
      searchResults.push({ title, year: year ? parseInt(year, 10) : void 0, url });
    });
    let showLink = (_a = searchResults.find((x) => x && compareMedia(ctx2.media, x.title, x.year))) == null ? void 0 : _a.url;
    if (!showLink) throw new NotFoundError("Content not found");
    if (ctx2.media.type === "show") {
      const seasonNumber = ctx2.media.season.number;
      const episodeNumber = ctx2.media.episode.number;
      const showPage = await ctx2.proxiedFetcher(showLink, { baseUrl: baseUrl$2 });
      const showPage$ = cheerio.load(showPage);
      const seasonBlock = showPage$("h4").filter((_, el) => showPage$(el).text().trim().split(":")[0].trim() === `Season${seasonNumber}`).parent();
      const episodes = seasonBlock.find("a").toArray();
      showLink = showPage$(
        episodes.find((el) => parseInt(showPage$(el).text().split(".")[0], 10) === episodeNumber)
      ).attr("href");
    }
    if (!showLink) throw new NotFoundError("Content not found");
    const contentPage = await ctx2.proxiedFetcher(showLink, { baseUrl: baseUrl$2 });
    const contentPage$ = cheerio.load(contentPage);
    const pass = contentPage$("#hId").attr("value");
    if (!pass) throw new NotFoundError("Content not found");
    ctx2.progress(50);
    const formData = new URLSearchParams();
    formData.append("pass", pass);
    formData.append("e2", "0");
    formData.append("server", "0");
    const infoEndpoint = ctx2.media.type === "show" ? "/home/index/getEInfoAjax" : "/home/index/getMInfoAjax";
    const streamRes = await ctx2.proxiedFetcher(infoEndpoint, {
      baseUrl: baseUrl$2,
      method: "POST",
      body: formData,
      headers: {
        referer: `${baseUrl$2}${showLink}`,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Viewport-Width": "375"
      }
    });
    const streamResJson = JSON.parse(streamRes);
    const captions = [];
    if (Array.isArray(streamResJson.subs)) {
      for (const sub of streamResJson.subs) {
        let language = "";
        if (sub.name.includes(".srt")) {
          const langName = sub.name.split(".srt")[0].trim();
          language = labelToLanguageCode(langName);
        } else if (sub.name.includes(":")) {
          const langName = sub.name.split(":")[0].trim();
          language = labelToLanguageCode(langName);
        } else {
          const langName = sub.name.trim();
          language = labelToLanguageCode(langName);
        }
        if (!language) continue;
        captions.push({
          id: sub.path,
          url: `${baseUrl$2}${sub.path}`,
          type: "srt",
          hasCorsRestrictions: false,
          language
        });
      }
    }
    ctx2.progress(90);
    const headers2 = {
      referer: `${baseUrl$2}${showLink}`,
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Viewport-Width": "375",
      Origin: baseUrl$2
    };
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          playlist: await convertPlaylistsToDataUrls(ctx2.proxiedFetcher, `${baseUrl$2}/${streamResJson.val}`, headers2),
          type: "hls",
          proxyDepth: 2,
          flags: [flags.CORS_ALLOWED],
          captions
        },
        ...streamResJson.val_bak ? [
          {
            id: "backup",
            playlist: await convertPlaylistsToDataUrls(
              ctx2.proxiedFetcher,
              `${baseUrl$2}/${streamResJson.val_bak}`,
              headers2
            ),
            type: "hls",
            flags: [flags.CORS_ALLOWED],
            proxyDepth: 2,
            captions
          }
        ] : []
      ]
    };
  };
  const soaperTvScraper = makeSourcerer({
    id: "soapertv",
    name: "SoaperTV",
    rank: 130,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: universalScraper,
    scrapeShow: universalScraper
  });
  const streamboxBase = "https://vidjoy.pro/embed/api/fastfetch";
  async function comboScraper$4(ctx2) {
    var _a, _b;
    const apiRes = await ctx2.proxiedFetcher(
      ctx2.media.type === "movie" ? `${streamboxBase}/${ctx2.media.tmdbId}?sr=0` : `${streamboxBase}/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}?sr=0`
    );
    if (!apiRes) {
      throw new NotFoundError("Failed to fetch StreamBox data");
    }
    console.log(apiRes);
    const data = await apiRes;
    const streams = {};
    data.url.forEach((stream) => {
      streams[stream.resulation] = stream.link;
    });
    const captions = data.tracks.map((track) => ({
      id: track.lang,
      url: track.url,
      language: track.code,
      type: "srt"
    }));
    if (data.provider === "MovieBox") {
      return {
        embeds: [],
        stream: [
          {
            id: "primary",
            captions,
            qualities: {
              ...streams["1080"] && {
                1080: {
                  type: "mp4",
                  url: streams["1080"]
                }
              },
              ...streams["720"] && {
                720: {
                  type: "mp4",
                  url: streams["720"]
                }
              },
              ...streams["480"] && {
                480: {
                  type: "mp4",
                  url: streams["480"]
                }
              },
              ...streams["360"] && {
                360: {
                  type: "mp4",
                  url: streams["360"]
                }
              }
            },
            type: "file",
            flags: [flags.CORS_ALLOWED],
            preferredHeaders: {
              Referer: (_a = data.headers) == null ? void 0 : _a.Referer
            }
          }
        ]
      };
    }
    const hlsStream = data.url.find((stream) => stream.type === "hls") || data.url[0];
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          captions,
          playlist: hlsStream.link,
          type: "hls",
          flags: [flags.CORS_ALLOWED],
          preferredHeaders: {
            Referer: (_b = data.headers) == null ? void 0 : _b.Referer
          }
        }
      ]
    };
  }
  const streamboxScraper = makeSourcerer({
    id: "streambox",
    name: "StreamBox",
    rank: 119,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$4,
    scrapeShow: comboScraper$4
  });
  const baseUrl$1 = "https://vidapi.click";
  async function comboScraper$3(ctx2) {
    const apiUrl2 = ctx2.media.type === "show" ? `${baseUrl$1}/api/video/tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}` : `${baseUrl$1}/api/video/movie/${ctx2.media.tmdbId}`;
    const apiRes = await ctx2.proxiedFetcher(apiUrl2, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!apiRes) throw new NotFoundError("Failed to fetch video source");
    if (!apiRes.sources[0].file) throw new NotFoundError("No video source found");
    ctx2.progress(50);
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "hls",
          playlist: apiRes.sources[0].file,
          flags: [flags.CORS_ALLOWED],
          captions: []
        }
      ]
    };
  }
  const vidapiClickScraper = makeSourcerer({
    id: "vidapi-click",
    name: "vidapi.click",
    rank: 89,
    disabled: true,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: comboScraper$3,
    scrapeShow: comboScraper$3
  });
  async function comboScraper$2(ctx2) {
    const query = {
      type: ctx2.media.type,
      title: ctx2.media.title,
      tmdbId: ctx2.media.tmdbId,
      imdbId: ctx2.media.imdbId,
      ...ctx2.media.type === "show" && {
        season: ctx2.media.season.number,
        episode: ctx2.media.episode.number
      },
      releaseYear: ctx2.media.releaseYear
    };
    return {
      embeds: [
        {
          embedId: "vidify-alfa",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-bravo",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-charlie",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-delta",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-echo",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-foxtrot",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-golf",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-hotel",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-india",
          url: JSON.stringify(query)
        },
        {
          embedId: "vidify-juliett",
          url: JSON.stringify(query)
        }
      ]
    };
  }
  const vidifyScraper = makeSourcerer({
    id: "vidify",
    name: "Vidify",
    rank: 124,
    disabled: true,
    flags: [],
    scrapeMovie: comboScraper$2,
    scrapeShow: comboScraper$2
  });
  const backendUrl = "https://backend.vidnest.fun";
  const servers = ["hollymoviehd", "allmovies", "flixhq", "official"];
  async function scrape(ctx2, type) {
    const embeds = [];
    for (const server of servers) {
      let url = "";
      if (type === "movie") {
        url = `${backendUrl}/${server}/movie/${ctx2.media.tmdbId}`;
      } else if (ctx2.media.type === "show") {
        url = `${backendUrl}/${server}/tv/${ctx2.media.tmdbId}/${ctx2.media.season.number}/${ctx2.media.episode.number}`;
      }
      embeds.push({
        embedId: `vidnest-${server}`,
        url
      });
    }
    return {
      embeds
    };
  }
  const vidnestScraper = makeSourcerer({
    id: "vidnest",
    name: "Vidnest",
    rank: 130,
    flags: [flags.CORS_ALLOWED],
    scrapeMovie: (ctx2) => scrape(ctx2, "movie"),
    scrapeShow: (ctx2) => scrape(ctx2, "tv")
  });
  async function getEmbeds(id, servers2, ctx2) {
    var _a;
    const embeds = [];
    for (const server of servers2.split(",")) {
      await ctx2.proxiedFetcher(`/getEmbed.php`, {
        baseUrl: warezcdnBase,
        headers: {
          Referer: `${warezcdnBase}/getEmbed.php?${new URLSearchParams({ id, sv: server })}`
        },
        method: "HEAD",
        query: { id, sv: server }
      });
      const embedPage = await ctx2.proxiedFetcher(`/getPlay.php`, {
        baseUrl: warezcdnBase,
        headers: {
          Referer: `${warezcdnBase}/getEmbed.php?${new URLSearchParams({ id, sv: server })}`
        },
        query: { id, sv: server }
      });
      const url = (_a = embedPage.match(/window.location.href\s*=\s*"([^"]+)"/)) == null ? void 0 : _a[1];
      if (url && server === "warezcdn") {
        embeds.push(
          { embedId: warezcdnembedHlsScraper.id, url },
          { embedId: warezcdnembedMp4Scraper.id, url },
          { embedId: warezPlayerScraper.id, url }
        );
      } else if (url && server === "mixdrop") embeds.push({ embedId: mixdropScraper.id, url });
    }
    return { embeds };
  }
  const warezcdnScraper = makeSourcerer({
    id: "warezcdn",
    name: "WarezCDN",
    disabled: true,
    rank: 115,
    flags: [],
    scrapeMovie: async (ctx2) => {
      if (!ctx2.media.imdbId) throw new NotFoundError("This source requires IMDB id.");
      const serversPage = await ctx2.proxiedFetcher(`/filme/${ctx2.media.imdbId}`, {
        baseUrl: warezcdnBase
      });
      const [, id, servers2] = serversPage.match(/let\s+data\s*=\s*'\[\s*\{\s*"id":"([^"]+)".*?"servers":"([^"]+)"/);
      if (!id || !servers2) throw new NotFoundError("Failed to find episode id");
      ctx2.progress(40);
      return getEmbeds(id, servers2, ctx2);
    }
    // scrapeShow: async (ctx) => {
    //   if (!ctx.media.imdbId) throw new NotFoundError('This source requires IMDB id.');
    //   const url = `${warezcdnBase}/serie/${ctx.media.imdbId}/${ctx.media.season.number}/${ctx.media.episode.number}`;
    //   const serversPage = await ctx.proxiedFetcher<string>(url);
    //   const seasonsApi = serversPage.match(/var\s+cachedSeasons\s*=\s*"([^"]+)"/)?.[1];
    //   if (!seasonsApi) throw new NotFoundError('Failed to find data');
    //   ctx.progress(40);
    //   const streamsData = await ctx.proxiedFetcher<cachedSeasonsRes>(seasonsApi, {
    //     baseUrl: warezcdnBase,
    //     headers: {
    //       Referer: url,
    //       'X-Requested-With': 'XMLHttpRequest',
    //     },
    //   });
    //   const season = Object.values(streamsData.seasons).find((s) => s.name === ctx.media.season.number.toString());
    //   if (!season) throw new NotFoundError('Failed to find season id');
    //   const episode = Object.values(season.episodes).find((e) => e.name === ctx.media.season.number.toString())?.id;
    //   if (!episode) throw new NotFoundError('Failed to find episode id');
    //   const episodeData = await ctx.proxiedFetcher<string>('/core/ajax.php', {
    //     baseUrl: warezcdnBase,
    //     headers: {
    //       Referer: url,
    //       'X-Requested-With': 'XMLHttpRequest',
    //     },
    //     query: { audios: episode },
    //   });
    //   const [, id, servers] = episodeData.replace(/\\"/g, '"').match(/"\[\s*\{\s*"id":"([^"]+)".*?"servers":"([^"]+)"/)!;
    //   if (!id || !servers) throw new NotFoundError('Failed to find episode id');
    //   return getEmbeds(id, servers, ctx);
    // },
  });
  const baseUrl = "https://wecima.tube";
  async function comboScraper$1(ctx2) {
    const searchPage = await ctx2.proxiedFetcher(`/search/${encodeURIComponent(ctx2.media.title)}/`, {
      baseUrl
    });
    const search$ = cheerio.load(searchPage);
    const firstResult = search$(".Grid--WecimaPosts .GridItem a").first();
    if (!firstResult.length) throw new NotFoundError("No results found");
    const contentUrl = firstResult.attr("href");
    if (!contentUrl) throw new NotFoundError("No content URL found");
    ctx2.progress(30);
    const contentPage = await ctx2.proxiedFetcher(contentUrl, { baseUrl });
    const content$ = cheerio.load(contentPage);
    let embedUrl;
    if (ctx2.media.type === "movie") {
      embedUrl = content$('meta[itemprop="embedURL"]').attr("content");
    } else {
      const seasonLinks = content$(".List--Seasons--Episodes a");
      let seasonUrl;
      for (const element of seasonLinks) {
        const text = content$(element).text().trim();
        if (text.includes(`موسم ${ctx2.media.season}`)) {
          seasonUrl = content$(element).attr("href");
          break;
        }
      }
      if (!seasonUrl) throw new NotFoundError(`Season ${ctx2.media.season} not found`);
      const seasonPage = await ctx2.proxiedFetcher(seasonUrl, { baseUrl });
      const season$ = cheerio.load(seasonPage);
      const episodeLinks = season$(".Episodes--Seasons--Episodes a");
      for (const element of episodeLinks) {
        const epTitle = season$(element).find("episodetitle").text().trim();
        if (epTitle === `الحلقة ${ctx2.media.episode}`) {
          const episodeUrl2 = season$(element).attr("href");
          if (episodeUrl2) {
            const episodePage = await ctx2.proxiedFetcher(episodeUrl2, { baseUrl });
            const episode$ = cheerio.load(episodePage);
            embedUrl = episode$('meta[itemprop="embedURL"]').attr("content");
          }
          break;
        }
      }
    }
    if (!embedUrl) throw new NotFoundError("No embed URL found");
    ctx2.progress(60);
    const embedPage = await ctx2.proxiedFetcher(embedUrl);
    const embed$ = cheerio.load(embedPage);
    const videoSource = embed$('source[type="video/mp4"]').attr("src");
    if (!videoSource) throw new NotFoundError("No video source found");
    ctx2.progress(90);
    return {
      embeds: [],
      stream: [
        {
          id: "primary",
          type: "file",
          flags: [],
          headers: {
            referer: baseUrl
          },
          qualities: {
            unknown: {
              type: "mp4",
              url: videoSource
            }
          },
          captions: []
        }
      ]
    };
  }
  const wecimaScraper = makeSourcerer({
    id: "wecima",
    name: "Wecima (Arabic)",
    rank: 3,
    disabled: false,
    flags: [],
    scrapeMovie: comboScraper$1,
    scrapeShow: comboScraper$1
  });
  async function comboScraper(ctx2) {
    const anilistId = await getAnilistIdFromMedia(ctx2, ctx2.media);
    const query = {
      type: ctx2.media.type,
      title: ctx2.media.title,
      tmdbId: ctx2.media.tmdbId,
      imdbId: ctx2.media.imdbId,
      anilistId,
      ...ctx2.media.type === "show" && {
        season: ctx2.media.season.number,
        episode: ctx2.media.episode.number
      },
      ...ctx2.media.type === "movie" && { episode: 1 },
      releaseYear: ctx2.media.releaseYear
    };
    return {
      embeds: [
        {
          embedId: "zunime-hd-2",
          url: JSON.stringify(query)
        },
        {
          embedId: "zunime-miko",
          url: JSON.stringify(query)
        },
        {
          embedId: "zunime-shiro",
          url: JSON.stringify(query)
        },
        {
          embedId: "zunime-zaza",
          url: JSON.stringify(query)
        }
      ]
    };
  }
  const zunimeScraper = makeSourcerer({
    id: "zunime",
    name: "Zunime",
    rank: 125,
    flags: [],
    scrapeShow: comboScraper
  });
  function gatherAllSources() {
    return [
      cuevana3Scraper,
      ridooMoviesScraper,
      hdRezkaScraper,
      warezcdnScraper,
      insertunitScraper,
      soaperTvScraper,
      autoembedScraper,
      myanimeScraper,
      tugaflixScraper,
      ee3Scraper,
      fsharetvScraper,
      vidsrcScraper,
      zoechipScraper,
      mp4hydraScraper,
      embedsuScraper,
      slidemoviesScraper,
      iosmirrorScraper,
      iosmirrorPVScraper,
      vidapiClickScraper,
      coitusScraper,
      streamboxScraper,
      nunflixScraper,
      EightStreamScraper,
      wecimaScraper,
      animeflvScraper,
      cinemaosScraper,
      nepuScraper,
      pirxcyScraper,
      vidsrcvipScraper,
      madplayScraper,
      rgshowsScraper,
      vidifyScraper,
      zunimeScraper,
      vidnestScraper,
      animetsuScraper,
      lookmovieScraper
    ];
  }
  function gatherAllEmbeds() {
    return [
      upcloudScraper,
      vidCloudScraper,
      mixdropScraper,
      ridooScraper,
      closeLoadScraper,
      doodScraper,
      streamvidScraper,
      streamtapeScraper,
      warezcdnembedHlsScraper,
      warezcdnembedMp4Scraper,
      warezPlayerScraper,
      autoembedEnglishScraper,
      autoembedHindiScraper,
      autoembedBengaliScraper,
      autoembedTamilScraper,
      autoembedTeluguScraper,
      turbovidScraper,
      mp4hydraServer1Scraper,
      mp4hydraServer2Scraper,
      VidsrcsuServer1Scraper,
      VidsrcsuServer2Scraper,
      VidsrcsuServer3Scraper,
      VidsrcsuServer4Scraper,
      VidsrcsuServer5Scraper,
      VidsrcsuServer6Scraper,
      VidsrcsuServer7Scraper,
      VidsrcsuServer8Scraper,
      VidsrcsuServer9Scraper,
      VidsrcsuServer10Scraper,
      VidsrcsuServer11Scraper,
      VidsrcsuServer12Scraper,
      VidsrcsuServer20Scraper,
      viperScraper,
      streamwishJapaneseScraper,
      streamwishLatinoScraper,
      streamwishSpanishScraper,
      streamwishEnglishScraper,
      streamtapeLatinoScraper,
      ...cinemaosEmbeds,
      // ...cinemaosHexaEmbeds,
      // vidsrcNovaEmbed,
      // vidsrcCometEmbed,
      // vidsrcPulsarEmbed,
      madplayBaseEmbed,
      madplayNsapiEmbed,
      madplayRoperEmbed,
      madplayNsapiVidFastEmbed,
      ...vidifyEmbeds,
      ...zunimeEmbeds,
      ...AnimetsuEmbeds,
      vidnestHollymoviehdEmbed,
      vidnestAllmoviesEmbed,
      vidnestFlixhqEmbed,
      vidnestOfficialEmbed,
      myanimesubScraper,
      myanimedubScraper
    ];
  }
  function getBuiltinSources() {
    return gatherAllSources().filter((v) => !v.disabled && !v.externalSource);
  }
  function getBuiltinExternalSources() {
    return gatherAllSources().filter((v) => v.externalSource && !v.disabled);
  }
  function getBuiltinEmbeds() {
    return gatherAllEmbeds().filter((v) => !v.disabled);
  }
  function findDuplicates(items, keyFn) {
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    }
    return Array.from(groups.entries()).filter(([_, groupItems]) => groupItems.length > 1).map(([key, groupItems]) => ({ key, items: groupItems }));
  }
  function formatDuplicateError(type, duplicates, keyName) {
    const duplicateList = duplicates.map(({ key, items }) => {
      const itemNames = items.map((item) => item.name || item.id).join(", ");
      return `  ${keyName} ${key}: ${itemNames}`;
    }).join("\n");
    return `${type} have duplicate ${keyName}s:
${duplicateList}`;
  }
  function getProviders(features, list) {
    const sources = list.sources.filter((v) => !(v == null ? void 0 : v.disabled));
    const embeds = list.embeds.filter((v) => !(v == null ? void 0 : v.disabled));
    const combined = [...sources, ...embeds];
    const duplicateIds = findDuplicates(combined, (v) => v.id);
    if (duplicateIds.length > 0) {
      throw new Error(formatDuplicateError("Sources/embeds", duplicateIds, "ID"));
    }
    const duplicateSourceRanks = findDuplicates(sources, (v) => v.rank);
    if (duplicateSourceRanks.length > 0) {
      throw new Error(formatDuplicateError("Sources", duplicateSourceRanks, "rank"));
    }
    const duplicateEmbedRanks = findDuplicates(embeds, (v) => v.rank);
    if (duplicateEmbedRanks.length > 0) {
      throw new Error(formatDuplicateError("Embeds", duplicateEmbedRanks, "rank"));
    }
    return {
      sources: sources.filter((s) => flagsAllowedInFeatures(features, s.flags)),
      embeds
    };
  }
  function makeProviders(ops) {
    var _a;
    const features = getTargetFeatures(
      ops.proxyStreams ? "any" : ops.target,
      ops.consistentIpForRequests ?? false,
      ops.proxyStreams
    );
    const sources = [...getBuiltinSources()];
    if (ops.externalSources === "all") sources.push(...getBuiltinExternalSources());
    else {
      (_a = ops.externalSources) == null ? void 0 : _a.forEach((source) => {
        const matchingSource = getBuiltinExternalSources().find((v) => v.id === source);
        if (!matchingSource) return;
        sources.push(matchingSource);
      });
    }
    const list = getProviders(features, {
      embeds: getBuiltinEmbeds(),
      sources
    });
    return makeControls({
      embeds: list.embeds,
      sources: list.sources,
      features,
      fetcher: ops.fetcher,
      proxiedFetcher: ops.proxiedFetcher,
      proxyStreams: ops.proxyStreams
    });
  }
  function buildProviders() {
    let consistentIpForRequests = false;
    let target = null;
    let fetcher = null;
    let proxiedFetcher = null;
    const embeds = [];
    const sources = [];
    const builtinSources = getBuiltinSources();
    const builtinExternalSources = getBuiltinExternalSources();
    const builtinEmbeds = getBuiltinEmbeds();
    return {
      enableConsistentIpForRequests() {
        consistentIpForRequests = true;
        return this;
      },
      setFetcher(f) {
        fetcher = f;
        return this;
      },
      setProxiedFetcher(f) {
        proxiedFetcher = f;
        return this;
      },
      setTarget(t) {
        target = t;
        return this;
      },
      addSource(input) {
        if (typeof input !== "string") {
          sources.push(input);
          return this;
        }
        const matchingSource = [...builtinSources, ...builtinExternalSources].find((v) => v.id === input);
        if (!matchingSource) throw new Error("Source not found");
        sources.push(matchingSource);
        return this;
      },
      addEmbed(input) {
        if (typeof input !== "string") {
          embeds.push(input);
          return this;
        }
        const matchingEmbed = builtinEmbeds.find((v) => v.id === input);
        if (!matchingEmbed) throw new Error("Embed not found");
        embeds.push(matchingEmbed);
        return this;
      },
      addBuiltinProviders() {
        sources.push(...builtinSources);
        embeds.push(...builtinEmbeds);
        return this;
      },
      build() {
        if (!target) throw new Error("Target not set");
        if (!fetcher) throw new Error("Fetcher not set");
        const features = getTargetFeatures(target, consistentIpForRequests);
        const list = getProviders(features, {
          embeds,
          sources
        });
        return makeControls({
          fetcher,
          proxiedFetcher: proxiedFetcher ?? void 0,
          embeds: list.embeds,
          sources: list.sources,
          features
        });
      }
    };
  }
  const isReactNative = () => {
    try {
      require("react-native");
      return true;
    } catch (e) {
      return false;
    }
  };
  function serializeBody(body) {
    if (body === void 0 || typeof body === "string" || body instanceof URLSearchParams || body instanceof FormData) {
      if (body instanceof URLSearchParams && isReactNative()) {
        return {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: body.toString()
        };
      }
      return {
        headers: {},
        body
      };
    }
    return {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    };
  }
  function getHeaders(list, res) {
    const output = new Headers();
    list.forEach((header) => {
      var _a;
      const realHeader = header.toLowerCase();
      const realValue = res.headers.get(realHeader);
      const extraValue = (_a = res.extraHeaders) == null ? void 0 : _a.get(realHeader);
      const value = extraValue ?? realValue;
      if (!value) return;
      output.set(realHeader, value);
    });
    return output;
  }
  function makeStandardFetcher(f) {
    const normalFetch = async (url, ops) => {
      var _a;
      const fullUrl = makeFullUrl(url, ops);
      const seralizedBody = serializeBody(ops.body);
      const controller = new AbortController();
      const timeout = 15e3;
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await f(fullUrl, {
          method: ops.method,
          headers: {
            ...seralizedBody.headers,
            ...ops.headers
          },
          body: seralizedBody.body,
          credentials: ops.credentials,
          signal: controller.signal
          // Pass the signal to fetch
        });
        clearTimeout(timeoutId);
        let body;
        const isJson = (_a = res.headers.get("content-type")) == null ? void 0 : _a.includes("application/json");
        if (isJson) body = await res.json();
        else body = await res.text();
        return {
          body,
          finalUrl: res.extraUrl ?? res.url,
          headers: getHeaders(ops.readHeaders, res),
          statusCode: res.status
        };
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error(`Fetch request to ${fullUrl} timed out after ${timeout}ms`);
        }
        throw error;
      }
    };
    return normalFetch;
  }
  const headerMap = {
    cookie: "X-Cookie",
    referer: "X-Referer",
    origin: "X-Origin",
    "user-agent": "X-User-Agent",
    "x-real-ip": "X-X-Real-Ip"
  };
  const responseHeaderMap = {
    "x-set-cookie": "Set-Cookie"
  };
  function makeSimpleProxyFetcher(proxyUrl, f) {
    const proxiedFetch = async (url, ops) => {
      const fetcher = makeStandardFetcher(async (a, b) => {
        const controller = new AbortController();
        const timeout = 15e3;
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
          const res = await f(a, {
            method: (b == null ? void 0 : b.method) || "GET",
            headers: (b == null ? void 0 : b.headers) || {},
            body: b == null ? void 0 : b.body,
            credentials: b == null ? void 0 : b.credentials,
            signal: controller.signal
            // Pass the signal to fetch
          });
          clearTimeout(timeoutId);
          res.extraHeaders = new Headers();
          Object.entries(responseHeaderMap).forEach((entry) => {
            var _a;
            const value = res.headers.get(entry[0]);
            if (!value) return;
            (_a = res.extraHeaders) == null ? void 0 : _a.set(entry[1].toLowerCase(), value);
          });
          res.extraUrl = res.headers.get("X-Final-Destination") ?? res.url;
          return res;
        } catch (error) {
          if (error.name === "AbortError") {
            throw new Error(`Fetch request to ${a} timed out after ${timeout}ms`);
          }
          throw error;
        }
      });
      const fullUrl = makeFullUrl(url, ops);
      const headerEntries = Object.entries(ops.headers).map((entry) => {
        const key = entry[0].toLowerCase();
        if (headerMap[key]) return [headerMap[key], entry[1]];
        return entry;
      });
      return fetcher(proxyUrl, {
        ...ops,
        query: {
          destination: fullUrl
        },
        headers: Object.fromEntries(headerEntries),
        baseUrl: void 0
      });
    };
    return proxiedFetch;
  }
  exports.NotFoundError = NotFoundError;
  exports.buildProviders = buildProviders;
  exports.createM3U8ProxyUrl = createM3U8ProxyUrl;
  exports.flags = flags;
  exports.getBuiltinEmbeds = getBuiltinEmbeds;
  exports.getBuiltinExternalSources = getBuiltinExternalSources;
  exports.getBuiltinSources = getBuiltinSources;
  exports.getM3U8ProxyUrl = getM3U8ProxyUrl;
  exports.makeProviders = makeProviders;
  exports.makeSimpleProxyFetcher = makeSimpleProxyFetcher;
  exports.makeStandardFetcher = makeStandardFetcher;
  exports.setM3U8ProxyUrl = setM3U8ProxyUrl;
  exports.setProxyUrl = setProxyUrl;
  exports.targets = targets;
  exports.updateM3U8ProxyUrl = updateM3U8ProxyUrl;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
});
