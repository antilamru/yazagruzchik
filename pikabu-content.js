/* Язагрузчик — Antilam (https://antilam.ru/)
 * One in-player download control per video-file player. Does not intercept playback.
 */
(() => {
  'use strict';

  const PLAYER_SELECTOR = '[data-role="player"][data-type="video-file"]';
  const VIDEO_EXT = /\.(mp4|webm|m4v|mov)$/i;
  const PREVIEW = /(?:_preview|preroll|advert|banner)\b/i;
  const mounted = new WeakMap();

  function getMediaUrl(value, base = 'https://pikabu.ru/') {
    if (typeof value !== 'string' || !value || value.startsWith('blob:')) return null;
    try {
      const url = new URL(value, base);
      if (url.protocol !== 'https:' || !/(^|\.)pikabu\.ru$/i.test(url.hostname) ||
          !VIDEO_EXT.test(url.pathname) || PREVIEW.test(url.pathname)) return null;
      return url.href;
    } catch { return null; }
  }

  function mediaQuality(url) {
    const filename = new URL(url).pathname.toLowerCase();
    if (/(?:_low|_240p|_360p|_480p)\.(?:mp4|webm|mov|m4v)$/.test(filename))
      return { label: 'Низкое', score: 100 };
    if (/(?:_high|_hd|_720p|_1080p|_fullhd|_2k|_4k)\.(?:mp4|webm|mov|m4v)$/.test(filename))
      return { label: 'Высокое', score: 300 };
    return { label: 'Обычное', score: 200 };
  }

  function mediaFromPlayer(player, discovered) {
    // Only the actual playback element. Timeline preview videos are intentionally excluded.
    const videos = player.querySelectorAll('video[data-video-player], [data-role="container"] > video');
    for (const video of videos) {
      if (video.closest('[class*="timeline"]')) continue;
      const sources = [video.currentSrc, video.getAttribute('src'), video.getAttribute('data-src')];
      for (const child of video.querySelectorAll('source')) {
        sources.push(child.getAttribute('src'), child.getAttribute('data-src'));
      }
      for (const src of sources) {
        const url = getMediaUrl(src, location.href);
        if (url) {
          const details = mediaQuality(url);
          discovered.set(url, { url, ...details });
        }
      }
    }
    // Older video-file players may expose a direct URL in data-source.
    const attr = getMediaUrl(player.getAttribute('data-source'), location.href);
    if (attr) discovered.set(attr, { url: attr, ...mediaQuality(attr) });
    return [...discovered.values()].sort((a, b) => b.score - a.score);
  }

  // Unit tests can import the URL/quality logic without a browser DOM.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getMediaUrl, mediaQuality, mediaFromPlayer };
    return;
  }
  if (typeof document === 'undefined') return;

  function addToPlayer(player) {
    const previous = mounted.get(player);
    if (previous && previous.host.isConnected) return;

    const discovered = previous?.discovered || new Map();
    const host = document.createElement('div');
    host.setAttribute('data-yazagruzchik', 'player');
    host.style.cssText = 'position:absolute!important;top:9px!important;right:9px!important;z-index:2147483647!important;pointer-events:auto!important;direction:ltr!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all:initial; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
        *,*:before,*:after{box-sizing:border-box}
        .wrap{position:relative;display:flex;align-items:center;filter:drop-shadow(0 2px 7px #0008)}
        button{font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;color:#fff;border:0}
        .main,.arrow{height:32px;background:rgba(16,30,46,.94);display:flex;align-items:center;justify-content:center;gap:6px}
        .main{padding:0 10px;border-radius:8px 0 0 8px;white-space:nowrap}
        .arrow{padding:0;width:27px;border-left:1px solid #ffffff24;border-radius:0 8px 8px 0}
        .main:hover,.arrow:hover,.choice:hover{background:#1b6cab}
        .main:disabled,.arrow:disabled{opacity:.65;cursor:wait}
        button:focus-visible{outline:2px solid #a2d6ff;outline-offset:2px}
        .panel,.status{position:absolute;right:0;top:39px;background:#17293d;color:#fff;border:1px solid #ffffff20;
          box-shadow:0 5px 18px #0009;border-radius:9px;max-width:min(280px,calc(100vw - 20px));z-index:2}
        .panel{width:230px;padding:7px}
        .status{width:max-content;min-width:170px;padding:9px 11px;font:500 12px/1.45 system-ui,sans-serif;overflow-wrap:anywhere}
        [hidden]{display:none!important}
        .choice{display:block;width:100%;text-align:left;background:#2b455f;border-radius:6px;padding:9px;margin:3px 0}
        .hint{color:#c9d6e8;font:400 11px/1.4 system-ui,sans-serif;padding:7px}
      </style>
      <div class="wrap">
        <button class="main" type="button" title="Скачать видео"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/></svg><span>Скачать</span></button>
        <button class="arrow" type="button" title="Выбрать качество">▾</button>
        <div class="panel" hidden></div><div class="status" role="status" aria-live="polite" hidden></div>
      </div>`;

    const main = shadow.querySelector('.main');
    const arrow = shadow.querySelector('.arrow');
    const panel = shadow.querySelector('.panel');
    const status = shadow.querySelector('.status');
    let hideTimer;

    function notify(message) {
      clearTimeout(hideTimer);
      panel.hidden = true;
      status.textContent = message;
      status.hidden = false;
      hideTimer = setTimeout(() => { status.hidden = true; }, 4000);
    }

    function formats() { return mediaFromPlayer(player, discovered); }

    function sendDownload(url) {
      return new Promise((resolve, reject) => {
        if (!chrome.runtime?.id) return reject(new Error('Расширение отключено.'));
        chrome.runtime.sendMessage({ action: 'download-pikabu', url }, response => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!response?.ok) return reject(new Error(response?.error || 'Не удалось начать скачивание.'));
          resolve(response);
        });
      });
    }

    async function download(url) {
      main.disabled = true;
      arrow.disabled = true;
      try {
        await sendDownload(url);
        notify('✓ Скачивание началось');
      } catch (error) {
        notify('Ошибка: ' + error.message);
      } finally {
        main.disabled = false;
        arrow.disabled = false;
      }
    }

    main.addEventListener('click', () => {
      panel.hidden = true;
      const list = formats();
      if (!list.length) return notify('Ссылка ещё не найдена. Запустите видео и повторите.');
      download(list[0].url);
    });

    arrow.addEventListener('click', () => {
      if (!panel.hidden) { panel.hidden = true; return; }
      status.hidden = true;
      panel.replaceChildren();
      const list = formats();
      if (!list.length) {
        const text = document.createElement('div');
        text.className = 'hint';
        text.textContent = 'Ссылка появится после загрузки видео.';
        panel.append(text);
      } else {
        list.forEach((format, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'choice';
          button.textContent = `${format.label} качество${index === 0 ? ' · лучшее' : ''}`;
          button.addEventListener('click', () => { panel.hidden = true; download(format.url); });
          panel.append(button);
        });
      }
      panel.hidden = false;
    });

    // Avoid toggling playback when the control is clicked.
    host.addEventListener('click', event => event.stopPropagation());
    host.addEventListener('pointerdown', event => event.stopPropagation());
    const position = getComputedStyle(player).position;
    if (position === 'static') player.style.setProperty('position', 'relative');
    player.append(host);

    // Preserve newly selected video qualities even if Vue later removes the old <source>.
    const watcher = new MutationObserver(() => { mediaFromPlayer(player, discovered); });
    watcher.observe(player, { childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'data-src', 'data-source'] });
    mediaFromPlayer(player, discovered);
    mounted.set(player, { host, discovered });
  }

  function scan(root = document) {
    if (root.matches?.(PLAYER_SELECTOR)) addToPlayer(root);
    root.querySelectorAll?.(PLAYER_SELECTOR).forEach(addToPlayer);
  }

  scan();
  // The site is a Vue SPA; players are often inserted after the initial page load.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) scan(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
