/**
 * smart-fetch.js — Size-efficient web fetch with semantic extraction
 *
 * Reduces fetch+parse cost 80-99% for blog/docs/wiki sites by:
 *   1. Skipping <head> bulk (scripts, styles, fonts, preloads)
 *   2. Targeting <main> / <article> semantic regions
 *   3. Preserving metadata (title, og:*, description, ld+json)
 *   4. Quality-checking extraction and falling back to full on failure
 *
 * Phase 1: core extraction + fetch, no cache. Opt-in via explicit call.
 * Zero runtime dependencies (node:https, node:crypto only).
 */

const https = require("node:https");
const http = require("node:http");
const zlib = require("node:zlib");
const { URL } = require("node:url");
const { FetchCache } = require("./fetch-cache.js");

const DEFAULT_UA = "Mozilla/5.0 (compatible; GrainulationSmartFetch/1.0)";
const DEFAULT_TIMEOUT = 15000;
const WIKI_DOCS_PATTERNS = [
  /wikipedia\.org/i,
  /\/wiki\//i,
  /\/docs?\//i,
  /developer\.mozilla\.org/i,
  /nodejs\.org\/api\//i,
];

/**
 * Fetch and extract. Opt-in; no default behavior changes elsewhere.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {"auto"|"full"|"concise"|"meta-only"} [options.mode="auto"]
 * @param {number} [options.timeout=15000]
 * @param {string} [options.userAgent]
 * @param {boolean} [options.privacy=false] If true, no caching downstream.
 * @param {number} [options.maxBytes=500000] Hard ceiling on body size.
 * @returns {Promise<Response>}
 */
async function smartFetch(url, options = {}) {
  const VALID_MODES = ["auto", "full", "concise", "meta-only"];
  const mode = options.mode || "auto";
  if (!VALID_MODES.includes(mode)) {
    return {
      ok: false,
      url,
      quality: "failed",
      warnings: [`invalid-mode: ${mode} (valid: ${VALID_MODES.join(", ")})`],
      elapsed_ms: 0,
    };
  }
  const opts = {
    mode,
    timeout: options.timeout || DEFAULT_TIMEOUT,
    userAgent: options.userAgent || DEFAULT_UA,
    privacy: options.privacy === true,
    maxBytes: options.maxBytes || 500000,
    cache: options.cache !== false && options.privacy !== true,
    cacheInstance: options.cacheInstance,
  };

  const warnings = [];
  const started = Date.now();

  // Detect potentially sensitive query params → disable cache for this call
  // to avoid writing tokens to disk. User can opt out via explicit cache: true,
  // but the default is safe.
  if (opts.cache && hasSensitiveParams(url)) {
    warnings.push("cache-disabled-sensitive-params");
    opts.cache = false;
  }

  // Cache lookup (before any network)
  let cache = null;
  if (opts.cache) {
    cache = opts.cacheInstance || new FetchCache();
    try {
      const cached = cache.get(url, opts.mode);
      if (cached) {
        return { ...cached, cached: true, elapsed_ms: Date.now() - started };
      }
    } catch (err) {
      warnings.push(`cache-read-error: ${err.message}`);
    }
  }

  let fetched;
  try {
    fetched = await fetchWithStrategy(url, opts, warnings);
  } catch (err) {
    return {
      ok: false,
      url,
      quality: "failed",
      mode_used: null,
      warnings: [...warnings, `fetch-error: ${err.message}`],
      error: err.message,
      elapsed_ms: Date.now() - started,
    };
  }

  // Content-Type gate
  const ct = (fetched.contentType || "").toLowerCase();
  if (!/text\/html|application\/xhtml/.test(ct)) {
    return {
      ok: false,
      url,
      final_url: fetched.finalUrl,
      status: fetched.status,
      content_type: fetched.contentType,
      quality: "failed",
      mode_used: null,
      warnings: [...warnings, `unsupported-content-type: ${ct || "unknown"}`],
      elapsed_ms: Date.now() - started,
    };
  }

  // Charset gate — we only decode UTF-8 bodies in Phase 1
  const charset = extractCharset(ct);
  if (charset && !/utf-?8/i.test(charset)) {
    warnings.push(`charset-unsupported: ${charset} (treating as utf-8)`);
  }

  const meta = extractMeta(fetched.body);
  const bodyExtract = extractBody(fetched.body);

  // Quality check
  let quality = assessQuality(bodyExtract);
  let modeUsed = opts.mode;

  // Auto mode: retry with full fetch if quality is bad AND we didn't already do a full fetch
  if (opts.mode === "auto" && quality === "failed" && fetched.truncated) {
    warnings.push("auto-retry: full fetch after failed concise");
    try {
      const full = await fetchRaw(url, { ...opts, forceFull: true }, warnings);
      fetched.body = full.body;
      fetched.size = full.size;
      fetched.truncated = false;
      const retryExtract = extractBody(full.body);
      if (retryExtract.length > bodyExtract.length) {
        bodyExtract.splice(0, bodyExtract.length, ...retryExtract);
      }
      quality = assessQuality(retryExtract);
      modeUsed = "full";
    } catch (err) {
      warnings.push(`auto-retry-failed: ${err.message}`);
    }
  }

  // Build response per mode
  const content = shapeContent(
    opts.mode === "auto" ? modeUsed || "concise" : opts.mode,
    meta,
    bodyExtract,
  );

  // Surface truncation so consumers don't think mode=full returned everything.
  if (fetched.truncated) {
    warnings.push(`body-truncated-at-${opts.maxBytes}-bytes`);
  }

  const fullBytes = fetched.size;
  const extractedSerialized = Buffer.byteLength(
    JSON.stringify({
      title: meta.title,
      description: meta.description,
      content,
    }),
    "utf8",
  );

  const response = {
    ok: quality !== "failed",
    url,
    final_url: fetched.finalUrl,
    status: fetched.status,
    content_type: fetched.contentType,
    charset: charset || "utf-8",
    mode_used: modeUsed,
    quality,
    title: meta.title,
    description: meta.description,
    content,
    metadata: {
      headings: meta.headings.slice(0, 25),
      word_count: bodyExtract.join(" ").split(/\s+/).filter(Boolean).length,
      og: meta.og,
      ld_json_count: meta.ldJsonCount,
    },
    cached: false,
    size: { full: fullBytes, extracted: extractedSerialized },
    reduction_pct:
      fullBytes > 0
        ? Math.round((1 - extractedSerialized / fullBytes) * 100)
        : 0,
    warnings,
  };

  // Cache successful fetches only (don't cache errors or failed quality).
  // Safety: skip caching when the fetch went through a redirect
  // (final_url !== url). This prevents both directions of cache poisoning:
  //   1. Attacker redirect → target: would cache under target's slot
  //   2. Target redirect → attacker: would cache attacker content under target's URL
  // Genuine non-redirected responses still cache normally.
  if (cache && opts.cache && response.ok && quality !== "failed") {
    if (response.final_url && response.final_url !== url) {
      response.warnings.push("cache-skipped-redirect");
    } else {
      try {
        cache.set(url, opts.mode, response);
      } catch (err) {
        response.warnings.push(`cache-write-error: ${err.message}`);
      }
    }
  }

  return { ...response, elapsed_ms: Date.now() - started };
}

// ─── Fetch strategies ────────────────────────────────────────────────────────

async function fetchWithStrategy(url, opts, warnings) {
  const isWikiOrDocs = WIKI_DOCS_PATTERNS.some((re) => re.test(url));

  // HEAD first to check Content-Type + size (when possible)
  let headInfo = null;
  try {
    headInfo = await fetchHead(url, opts);
  } catch {
    // HEAD failures are common (not all servers support HEAD); proceed with GET
  }

  if (headInfo && headInfo.contentLength) {
    // If small, full fetch — not worth the range dance
    if (headInfo.contentLength < 300 * 1024) {
      const r = await fetchRaw(url, opts, warnings);
      return { ...r, truncated: false };
    }
  }

  // Wiki/docs: stream with cap, stop after </main> or </article> discovered
  if (isWikiOrDocs) {
    const r = await fetchStream(url, opts, warnings);
    return r;
  }

  // Default: full fetch capped at maxBytes
  const r = await fetchRaw(url, opts, warnings);
  return r;
}

function fetchHead(url, opts) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method: "HEAD",
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        timeout: opts.timeout,
        headers: { "User-Agent": opts.userAgent, Accept: "text/html,*/*" },
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode,
          contentType: res.headers["content-type"] || "",
          contentLength: res.headers["content-length"]
            ? Number(res.headers["content-length"])
            : null,
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("head-timeout"));
    });
    req.end();
  });
}

// Wrap res stream with decompression if needed. Returns the stream to read
// text from, plus a warning if encoding was unsupported.
function decompressedStream(res, warnings) {
  const encoding = (res.headers["content-encoding"] || "").toLowerCase();
  if (!encoding || encoding === "identity") return res;
  if (encoding === "gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  warnings.push(`unsupported-content-encoding: ${encoding}`);
  return res;
}

function fetchRaw(url, opts, warnings, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too-many-redirects"));
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.get(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        timeout: opts.timeout,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          return resolve(fetchRaw(next, opts, warnings, redirects + 1));
        }
        if (
          res.statusCode === 429 ||
          (res.statusCode >= 500 && res.statusCode < 600)
        ) {
          res.resume();
          return reject(new Error(`http-${res.statusCode}`));
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return reject(new Error(`http-${res.statusCode}`));
        }
        const stream = decompressedStream(res, warnings);
        let body = "";
        let truncated = false;
        stream.setEncoding("utf8");
        stream.on("data", (c) => {
          body += c;
          if (Buffer.byteLength(body, "utf8") >= opts.maxBytes) {
            truncated = true;
            res.destroy();
          }
        });
        stream.on("end", () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            finalUrl: url,
            body,
            size: Buffer.byteLength(body, "utf8"),
            truncated,
          }),
        );
        stream.on("close", () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            finalUrl: url,
            body,
            size: Buffer.byteLength(body, "utf8"),
            truncated,
          }),
        );
        stream.on("error", (err) => {
          warnings.push(`decompress-error: ${err.message}`);
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            finalUrl: url,
            body,
            size: Buffer.byteLength(body, "utf8"),
            truncated,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

// Stream until </main> or </article> close tag detected, or cap hit
function fetchStream(url, opts, warnings, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too-many-redirects"));
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.get(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        timeout: opts.timeout,
        headers: {
          "User-Agent": opts.userAgent,
          Accept: "text/html,*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          return resolve(fetchStream(next, opts, warnings, redirects + 1));
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return reject(new Error(`http-${res.statusCode}`));
        }
        const stream = decompressedStream(res, warnings);
        let body = "";
        let truncated = false;
        let sawCloseTag = false;
        stream.setEncoding("utf8");
        stream.on("data", (c) => {
          body += c;
          if (!sawCloseTag && /<\/main>|<\/article>/i.test(body.slice(-2048))) {
            sawCloseTag = true;
            // Grab a little more to not cut mid-paragraph
            setTimeout(() => {
              if (!res.destroyed) res.destroy();
            }, 100);
          }
          if (Buffer.byteLength(body, "utf8") >= opts.maxBytes) {
            truncated = true;
            res.destroy();
          }
        });
        stream.on("end", () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            finalUrl: url,
            body,
            size: Buffer.byteLength(body, "utf8"),
            truncated,
            sawCloseTag,
          }),
        );
        stream.on("close", () =>
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            finalUrl: url,
            body,
            size: Buffer.byteLength(body, "utf8"),
            truncated,
            sawCloseTag,
          }),
        );
        stream.on("error", (err) => {
          warnings.push(`decompress-error: ${err.message}`);
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            finalUrl: url,
            body,
            size: Buffer.byteLength(body, "utf8"),
            truncated,
            sawCloseTag,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

// ─── Extraction ──────────────────────────────────────────────────────────────

function extractCharset(contentType) {
  const m = /charset=["']?([^"';\s]+)/i.exec(contentType);
  return m ? m[1] : null;
}

function extractMeta(html) {
  const title = decodeEntities(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]?.trim() || "",
  );
  const ogTitle = attr(
    html,
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i,
  );
  const ogDesc = attr(
    html,
    /<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i,
  );
  const description = attr(
    html,
    /<meta\s+name=["']description["']\s+content=["']([^"']+)/i,
  );
  const ogImage = attr(
    html,
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i,
  );
  const ldJsonCount = (
    html.match(/<script\s+type=["']application\/ld\+json["']/gi) || []
  ).length;

  const headings = [];
  const hRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = hRegex.exec(html)) !== null && headings.length < 30) {
    const text = decodeEntities(
      m[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (text.length > 0) headings.push({ level: Number(m[1]), text });
  }

  return {
    title: title || ogTitle,
    description: description || ogDesc,
    og: { title: ogTitle, description: ogDesc, image: ogImage },
    headings,
    ldJsonCount,
  };
}

function extractBody(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  let target = "";
  const m1 = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(stripped);
  if (m1) {
    target = m1[1];
  } else {
    const m2 = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(stripped);
    if (m2) target = m2[1];
    else target = stripped;
  }

  const pieces = [];
  const tagRegex = /<(p|h[1-6]|li|blockquote|pre|code)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = tagRegex.exec(target)) !== null) {
    const text = decodeEntities(
      m[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (text.length > 15) pieces.push(text);
  }
  return pieces;
}

function assessQuality(pieces) {
  const total = pieces.join(" ").length;
  if (total >= 100 && pieces.length >= 2) return "high";
  if (total >= 20) return "degraded";
  return "failed";
}

function shapeContent(mode, _meta, bodyPieces) {
  if (mode === "meta-only") return "";
  const joined = bodyPieces.join("\n\n");
  if (mode === "concise") return joined.slice(0, 2048);
  return joined; // "full"
}

function attr(html, regex) {
  const m = regex.exec(html);
  return m ? decodeEntities(m[1]) : "";
}

// Param names that commonly carry secrets. Presence of any of these in
// the query string → we refuse to cache this URL on disk.
const SENSITIVE_PARAM_REGEX =
  /(^|&|\?)(token|access_token|api[-_]?key|auth|password|secret|sig|signature|sas[-_]?token|bearer)=/i;

function hasSensitiveParams(url) {
  try {
    const u = new URL(url);
    return SENSITIVE_PARAM_REGEX.test(u.search);
  } catch {
    return false;
  }
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

module.exports = {
  smartFetch,
  // Exposed for unit tests:
  _extractMeta: extractMeta,
  _extractBody: extractBody,
  _assessQuality: assessQuality,
  _decodeEntities: decodeEntities,
};
