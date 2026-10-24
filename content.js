/* Язагрузчик — Antilam. Runs independently in each YapFiles iframe. */
(() => {
  'use strict';

  const currentUrl = new URL(location.href);
  if (!/^\/get_player\/?$/i.test(currentUrl.pathname)) return;
  const videoId = currentUrl.searchParams.get('v') || '';
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(videoId)) return;
  if (document.getElementById('__yazagruzchik_root')) return;

  const discovered = new Map();
  let resolving = null;
  let toastTimer = null;

  function parseMediaUrl(value) {
    if (typeof value !== 'string' || !value || value.startsWith('blob:')) return null;
    try {
      const url = new URL(value, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (!/\.(mp4|webm|m4v|mov)(?:$|\/)/i.test(url.pathname)) return null;
      if (/\b(?:preroll|banner|advert|vast|teaser)\b/i.test(url.href)) return null;
      return url.href;
    } catch { return null; }
  }

  function noteMedia(raw, label = 'MP4') {
    const url = parseMediaUrl(raw);
    if (url) discovered.set(url, { url, quality: label });
  }

  function collectObserved() {
    for (const media of document.querySelectorAll('video, source')) {
      if (media.currentSrc) noteMedia(media.currentSrc);
      if (media.src) noteMedia(media.src);
      if (media.getAttribute('data-src')) noteMedia(media.getAttribute('data-src'));
    }
    for (const entry of performance.getEntriesByType('resource')) noteMedia(entry.name);
    return [...discovered.values()].slice(-50);
  }

  function findInitUrls() {
    const found = new Set();
    const re = /\bplayer\.init\s*\(\s*(['"`])((?:(?!\1)[^\n]){1,2000}?)\1/gi;
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (text.length > 150000) continue;
      re.lastIndex = 0;
      let result;
      while ((result = re.exec(text))) {
        try {
          const decoded = result[2].replace(/\\\//g, '/').replace(/&amp;/gi, '&');
          const url = new URL(decoded, location.href);
          if (/(^|\.)yapfiles\.ru$/i.test(url.hostname)) found.add(url.href);
        } catch { /* ignored */ }
      }
    }
    return [...found];
  }

  // Resource Timing sees real MP4 files even when the player uses a blob: URL.
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) noteMedia(entry.name);
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch { /* Browser/player may restrict timing information. */ }

  const host = document.createElement('div');
  host.id = '__yazagruzchik_root';
  host.setAttribute('data-extension', 'Язагрузчик');
  host.style.cssText = 'position:fixed!important;right:10px!important;top:10px!important;z-index:2147483647!important;pointer-events:none!important;direction:ltr!important;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host {all: initial; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      * {box-sizing:border-box;}
      .wrap {position:relative; display:flex; align-items:stretch; filter:drop-shadow(0 3px 9px rgba(0,0,0,.28)); pointer-events:auto;}
      button {font:600 12px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;border:0;}
      .main, .expand {height:32px;background:rgba(19,30,42,.92);color:white;transition:background .16s;display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;}
      .main:hover,.expand:hover {background:#126dca;}
      .main {padding:0 11px; border-radius:8px 0 0 8px;}
      .main:disabled {opacity:.7;cursor:wait;}
      .expand {width:27px;border-left:1px solid rgba(255,255,255,.15);border-radius:0 8px 8px 0;padding:0;}
      .arrow {font-size:10px;}
      .panel {position:absolute;right:0;top:39px;width:238px;max-width:calc(100vw - 16px);background:rgba(20,31,44,.98);color:#f7fafc;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:9px;box-shadow:0 6px 20px #0007;}
      .panel[hidden] {display:none!important;}
      .heading {font:700 12px/1.4 system-ui,sans-serif;color:#d9e9f9;margin:0 0 7px 3px;}
      .detail {font:400 11px/1.45 system-ui,sans-serif;color:#b9c8da;padding:5px 4px 3px;overflow-wrap:anywhere;}
      .format {width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#fff;padding:9px;border-radius:6px;background:#284259;text-align:left;margin:3px 0;}
      .format:hover{background:#2367ad;}
      .muted{font-size:10px;color:#c4d3de;font-weight:400;}
      .toast {position:absolute;right:0;top:39px;min-width:190px;max-width:min(260px,calc(100vw - 16px));background:#1a3248;color:#fff;padding:9px 12px;border-radius:8px;box-shadow:0 4px 14px #0008;font:500 11px/1.45 system-ui,sans-serif;overflow-wrap:anywhere;}
      .toast[hidden] {display:none!important;}
      button:focus-visible{outline:2px solid #95c7ff;outline-offset:2px;}
      @media(max-width:300px){.main{padding:0 7px}.main .label{display:none}.expand{width:23px}}
    </style>
    <div class="wrap">
      <button class="main" type="button" title="Скачать видео в максимальном качестве" aria-label="Скачать видео">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/></svg>
        <span class="label">Скачать</span>
      </button>
      <button class="expand" type="button" title="Выбрать качество" aria-label="Выбрать качество"><span class="arrow">▾</span></button>
      <div class="panel" hidden><div class="heading">Язагрузчик · Выбор качества</div><div class="options"></div></div>
      <div class="toast" role="status" aria-live="polite" hidden></div>
    </div>`;

  const main = root.querySelector('.main');
  const expand = root.querySelector('.expand');
  const panel = root.querySelector('.panel');
  const options = root.querySelector('.options');
  const toast = root.querySelector('.toast');

  function showMessage(text) {
    if (toastTimer) clearTimeout(toastTimer);
    panel.hidden = true;
    toast.textContent = text;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3700);
  }

  function setLoading(value) {
    main.disabled = value;
    main.querySelector('.label').textContent = value ? 'Ищем…' : 'Скачать';
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime?.id) { reject(new Error('Расширение отключено.')); return; }
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!response || !response.ok) { reject(new Error(response?.error || 'Нет ответа от расширения.')); return; }
        resolve(response);
      });
    });
  }

  async function resolve() {
    if (resolving) return resolving;
    resolving = (async () => {
      // Recheck every time: many players load video URLs only after Play is clicked.
      const response = await send({ action: 'resolve', videoId,
        initUrls: findInitUrls(), observed: collectObserved() });
      return response;
    })();
    try { return await resolving; }
    finally { resolving = null; }
  }

  async function download(format, title) {
    const response = await send({ action: 'download', videoId, format, title });
    showMessage('✓ Скачивание началось. Файл будет сохранён в папку загрузок Chrome.');
    return response;
  }

  function renderOptions(data) {
    options.replaceChildren();
    if (!data.formats.length) {
      const status = document.createElement('div');
      status.className = 'detail';
      status.textContent = data.reason || 'Видеофайл не найден. Запустите ролик и повторите.';
      options.append(status);
      return;
    }
    data.formats.forEach((format, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'format';
      const quality = document.createElement('span');
      quality.textContent = format.quality === 'HD' ? 'Высокое качество · HD' :
        format.quality === 'SD' ? 'Обычное качество · SD' : 'Видеофайл · MP4';
      const detail = document.createElement('span');
      detail.className = 'muted';
      detail.textContent = i === 0 ? 'Лучшее' : '↓';
      item.append(quality, detail);
      item.addEventListener('click', async () => {
        panel.hidden = true;
        try { await download(format, data.title); }
        catch (err) { showMessage(`Ошибка: ${err.message}`); }
      });
      options.append(item);
    });
  }

  main.addEventListener('click', async () => {
    if (main.disabled) return;
    panel.hidden = true;
    toast.hidden = true;
    setLoading(true);
    try {
      const data = await resolve();
      if (!data.formats.length) { showMessage(data.reason || 'Ссылка на видео не найдена.'); return; }
      await download(data.formats[0], data.title);
    } catch (err) { showMessage(`Ошибка: ${err.message}`); }
    finally { setLoading(false); }
  });

  expand.addEventListener('click', async () => {
    if (!panel.hidden) { panel.hidden = true; return; }
    toast.hidden = true;
    options.replaceChildren();
    const status = document.createElement('div');
    status.className = 'detail';
    status.textContent = 'Определяем доступное качество…';
    options.append(status);
    panel.hidden = false;
    try { renderOptions(await resolve()); }
    catch (err) { status.textContent = `Ошибка: ${err.message}`; }
  });

  // Prevent clicks on an overlay from triggering the underlying video player.
  host.addEventListener('pointerdown', event => event.stopPropagation());
  host.addEventListener('click', event => event.stopPropagation());
  document.documentElement.append(host);
})();
