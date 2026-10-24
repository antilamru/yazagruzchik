/*
 * Язагрузчик — Antilam (https://antilam.ru/)
 * Service worker: safely resolve YapFiles' own JSON playlist and initiate Chrome downloads.
 * No analytics, no servers operated by the extension.
 */
'use strict';

const API_HOST = /(^|\.)yapfiles\.ru$/i;
const PIKABU_HOST = /(^|\.)pikabu\.ru$/i;
const VALID_ID = /^[A-Za-z0-9_-]{8,96}$/;
const LEGACY_HASH = 'ded5f369be61b8ae5f88e2eeb2f3caff';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8500;

function parseHttpUrl(value, base) {
  if (typeof value !== 'string' || !value || value.length > 8192) return null;
  try {
    const url = new URL(value.replace(/&amp;/gi, '&').replace(/\\\//g, '/'), base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

function isYapFilesUrl(value) {
  const url = parseHttpUrl(value);
  return Boolean(url && API_HOST.test(url.hostname));
}

function isVideoUrl(value) {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const p = url.pathname.toLowerCase();
  if (/\.(?:m3u8|mpd|m4s|ts|jpg|jpeg|png|gif|webp|json)(?:$|\/)/.test(p)) return false;
  return /\.(?:mp4|m4v|webm|mov)(?:$|\/)/.test(p);
}

function cleanTitle(input) {
  return String(input || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim()
    .slice(0, 100);
}

function extensionFor(url) {
  try {
    const match = new URL(url).pathname.match(/\.(mp4|m4v|webm|mov)(?:$|\/)/i);
    return match ? match[1].toLowerCase() : 'mp4';
  } catch { return 'mp4'; }
}

function qualityDetails(key, hint = '') {
  const v = `${key} ${hint}`.toLowerCase();
  if (/hd|high|1080|720|2160|1440|4k|full/.test(v)) return { label: 'HD', priority: 300 };
  if (/sd|low|360|480|240/.test(v) || key.toLowerCase() === 'file') return { label: 'SD', priority: 200 };
  return { label: 'MP4', priority: 100 };
}

function makeCollector() {
  const urls = new Map();
  const refs = new Set();
  let title = '';
  let hasHls = false;

  function addUrl(raw, key = 'file', hint = '', source = 'api') {
    const url = parseHttpUrl(raw, 'https://api.yapfiles.ru/');
    if (!url) return;
    if (/\.(?:m3u8|mpd)(?:$|\?)/i.test(url.pathname)) {
      hasHls = true;
      return;
    }
    if (!isVideoUrl(url.href) && !/^(?:file|file_hd|src|video_url)$/i.test(key)) return;
    if (/\b(?:preroll|advert|ads?|banner|vast|teaser)\b/i.test(url.href)) return;
    const quality = qualityDetails(key, hint);
    const old = urls.get(url.href);
    if (!old || old.priority < quality.priority) {
      urls.set(url.href, { url: url.href, quality: quality.label, priority: quality.priority,
        source });
    }
  }

  function visit(data, depth = 0, key = '', hint = '') {
    if (depth > 12 || data == null) return;
    if (Array.isArray(data)) {
      for (const item of data.slice(0, 60)) visit(item, depth + 1, key, hint);
      return;
    }
    if (typeof data === 'string') {
      if (key === 'playlist' || key === 'playlist_url') {
        const url = parseHttpUrl(data, 'https://api.yapfiles.ru/');
        if (url && isYapFilesUrl(url.href)) refs.add(url.href);
        else if (url && /\.m3u8/i.test(url.pathname)) hasHls = true;
      } else if (/^(file|file_hd|src|video_url|url|mp4)$/i.test(key) || isVideoUrl(data)) {
        addUrl(data, key, hint);
      }
      return;
    }
    if (typeof data !== 'object') return;
    if (!title && typeof data.title === 'string' && data.title.length < 300) {
      title = data.title;
    }
    const newHint = String(data.label || data.quality || data.resolution || hint).slice(0, 80);
    for (const [childKey, value] of Object.entries(data).slice(0, 120)) {
      if (/^(poster|thumbnail|image|cover|ad|ads|advert|preroll|vast)$/i.test(childKey)) continue;
      visit(value, depth + 1, childKey, newHint);
    }
  }

  function result() {
    return { formats: [...urls.values()].sort((a, b) => b.priority - a.priority),
      title, hasHls, pending: [...refs] };
  }
  return { addUrl, visit, result };
}

async function downloadJson(url) {
  if (!isYapFilesUrl(url)) throw new Error('Источником JSON может быть только YapFiles.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'include', cache: 'no-store',
      headers: { 'Accept': 'application/json, text/plain, */*' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredBytes = Number(response.headers.get('content-length') || 0);
    if (declaredBytes > MAX_JSON_BYTES) throw new Error('Слишком большой ответ API.');
    const text = await response.text();
    if (text.length > MAX_JSON_BYTES) throw new Error('Слишком большой ответ API.');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } finally { clearTimeout(timer); }
}

async function resolveVideo({ videoId, initUrls = [], observed = [] }) {
  if (!VALID_ID.test(videoId)) throw new Error('Неверный идентификатор видео.');
  const collector = makeCollector();
  for (const video of observed.slice(0, 60)) {
    if (typeof video !== 'object' || !video) continue;
    const url = parseHttpUrl(video.url);
    if (!url || !isVideoUrl(url.href)) continue;
    collector.addUrl(url.href, video.quality || 'observed', '', 'player');
  }

  const apiEndpoints = [];
  for (const candidate of initUrls.slice(0, 10)) {
    const url = parseHttpUrl(candidate, `https://api.yapfiles.ru/`);
    if (url && API_HOST.test(url.hostname)) apiEndpoints.push(url.href);
  }
  // Compatibility with the YapFiles JSON API used by its player.
  const fallback = new URL(`https://api.yapfiles.ru/load/${encodeURIComponent(videoId)}/`);
  fallback.searchParams.set('md5', LEGACY_HASH);
  fallback.searchParams.set('type', 'json');
  fallback.searchParams.set('ref', `https://api.yapfiles.ru/get_player/?v=${encodeURIComponent(videoId)}`);
  apiEndpoints.push(fallback.href);

  const attempted = new Set();
  let apiErrors = 0;
  // Try preferred player URL first; if it has a nested playlist, fetch that
  // before falling back to the historical API endpoint.
  for (const url of apiEndpoints) {
    if (attempted.has(url)) continue;
    attempted.add(url);
    try { collector.visit(await downloadJson(url)); }
    catch { apiErrors += 1; }

    let steps = 0;
    while (steps++ < 6) {
      const next = collector.result().pending.find(item => !attempted.has(item));
      if (!next) break;
      attempted.add(next);
      try { collector.visit(await downloadJson(next)); }
      catch { apiErrors += 1; }
    }
    if (collector.result().formats.length) break;
  }

  const result = collector.result();
  return {
    formats: result.formats,
    title: result.title,
    hasHls: result.hasHls,
    reason: result.formats.length ? null : (result.hasHls
      ? 'Этот ролик доступен только как поток HLS/DASH. Сохранение потока в MP4 не поддерживается.'
      : apiErrors ? 'Не удалось извлечь MP4. Попробуйте запустить воспроизведение и повторить.'
        : 'Видеофайл не обнаружен. Попробуйте запустить воспроизведение и повторить.')
  };
}

function isPikabuVideoUrl(value) {
  const url = parseHttpUrl(value);
  return Boolean(url && url.protocol === 'https:' && PIKABU_HOST.test(url.hostname) &&
    /\.(mp4|webm|m4v|mov)$/i.test(url.pathname) &&
    !/(?:_preview|\bpreroll\b|\badvert\b)/i.test(url.pathname));
}

async function startPikabuDownload(message) {
  if (!isPikabuVideoUrl(message.url)) throw new Error('Не найдена прямая ссылка на видео.');
  const url = new URL(message.url);
  let basename = url.pathname.split('/').pop() || 'video.mp4';
  try { basename = decodeURIComponent(basename); } catch { /* leave encoded */ }
  const ext = extensionFor(url.href);
  const name = cleanTitle(basename.replace(/\.(?:mp4|webm|m4v|mov)$/i, '')) || 'video';
  const filename = `${name}.${ext}`;
  const id = await chrome.downloads.download({
    url: url.href,
    filename,
    conflictAction: 'uniquify',
    saveAs: false
  });
  if (typeof id !== 'number') throw new Error('Chrome не запустил скачивание.');
  return { downloadId: id, filename };
}

function isPikabuSender(sender) {
  const url = parseHttpUrl(sender?.url);
  return Boolean(url && PIKABU_HOST.test(url.hostname));
}

function isTrustedSender(sender) {
  return Boolean(sender && typeof sender.url === 'string' && isYapFilesUrl(sender.url));
}

async function startDownload(message) {
  const { videoId, format, title } = message;
  if (!VALID_ID.test(videoId)) throw new Error('Неверный ID видео.');
  if (!format || !parseHttpUrl(format.url) ||
      /\.(?:m3u8|mpd)(?:$|\?)/i.test(new URL(format.url).pathname) ||
      (!isVideoUrl(format.url) && format.source !== 'api')) {
    throw new Error('Не найдена прямая ссылка на видеофайл.');
  }
  const quality = /^(HD|SD)$/.test(format.quality) ? `_${format.quality}` : '';
  const base = cleanTitle(title) || `YapFiles_${videoId}`;
  const extension = extensionFor(format.url);
  const filename = `${base}_${videoId}${quality}.${extension}`;
  const id = await chrome.downloads.download({
    url: format.url,
    filename,
    conflictAction: 'uniquify',
    saveAs: false
  });
  if (typeof id !== 'number') throw new Error('Chrome не запустил скачивание.');
  return { downloadId: id, filename };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.action === 'download-pikabu') {
    if (!isPikabuSender(sender)) return false;
    Promise.resolve().then(() => startPikabuDownload(message))
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || 'Неизвестная ошибка.' }));
    return true;
  }
  if (!isTrustedSender(sender)) return false;
  if (message.action !== 'resolve' && message.action !== 'download') return false;
  const work = message.action === 'resolve'
    ? resolveVideo(message)
    : startDownload(message);
  Promise.resolve(work).then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error.message || 'Неизвестная ошибка.' }));
  return true;
});

// Export for local automated unit tests (no effect inside Chrome's service worker).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseHttpUrl, isVideoUrl, cleanTitle, makeCollector,
    resolveVideo, startDownload, extensionFor, isPikabuVideoUrl, startPikabuDownload, isPikabuSender };
}
