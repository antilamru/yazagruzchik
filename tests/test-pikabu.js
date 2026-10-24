'use strict';
const assert = require('node:assert/strict');
global.location = {href:'https://pikabu.ru/story/test'};
const downloaded = [];
const listeners = [];
global.chrome = {
  downloads: { async download(options) { downloaded.push(options); return 77; } },
  runtime: { onMessage: { addListener(callback) { listeners.push(callback); } } }
};
const { isPikabuVideoUrl, startPikabuDownload, isPikabuSender } = require('../background.js');
const { getMediaUrl, mediaQuality, mediaFromPlayer } = require('../pikabu-content.js');

const SRC = 'https://cs3.pikabu.ru/s/2026/10/23/17/7gt7bvw2_s0f0d10m0_720x1280_low.mp4';
const PREVIEW = 'https://cs3.pikabu.ru/s/2026/10/23/17/7gt7bvw2_s0f0d10m0_720x1280_preview.mp4';
async function tests() {
  assert.equal(isPikabuVideoUrl(SRC), true);
  assert.equal(getMediaUrl(SRC), SRC);
  assert.equal(getMediaUrl(PREVIEW), null);
  assert.equal(isPikabuVideoUrl(PREVIEW), false);
  assert.equal(getMediaUrl('blob:https://pikabu.ru/abcd'), null);
  assert.equal(isPikabuVideoUrl('https://pikabu.com/a.mp4'), false);
  assert.equal(isPikabuVideoUrl('https://evil.net/a.mp4'), false);
  assert.equal(isPikabuVideoUrl('https://cs3.pikabu.ru/img.webp'), false);
  assert.equal(isPikabuVideoUrl('javascript:alert(1)'), false);
  assert.equal(mediaQuality(SRC).label, 'Низкое');
  assert.equal(mediaQuality('https://cs3.pikabu.ru/foo_1080p.mp4').score, 300);

  // Mock original provided Pikabu <video><source> player structure.
  function video(src) {
    return {currentSrc: '', getAttribute: key => key === 'src' ? null : null,
      closest: () => null, querySelectorAll: selector => selector === 'source' ? [{getAttribute: k => k === 'src' ? src : null}] : []};
  }
  let vids = [video(SRC)];
  const player = {getAttribute: () => null,
    querySelectorAll: () => vids};
  const cache = new Map();
  assert.deepEqual(mediaFromPlayer(player, cache).map(x=>x.url), [SRC]);
  vids = [video('https://cs3.pikabu.ru/second_high.mp4')];
  assert.deepEqual(mediaFromPlayer(player, cache).map(x=>x.label), ['Высокое', 'Низкое']);

  await startPikabuDownload({url: SRC});
  assert.equal(downloaded[0].filename, '7gt7bvw2_s0f0d10m0_720x1280_low.mp4');
  assert.equal(downloaded[0].saveAs, false);
  assert.equal(downloaded[0].filename.includes('/'), false);
  await assert.rejects(startPikabuDownload({url: PREVIEW}));
  await assert.rejects(startPikabuDownload({url: 'https://evil.net/other.mp4'}));
  assert.equal(isPikabuSender({url:'https://pikabu.ru/story/example_9999'}), true);
  assert.equal(isPikabuSender({url:'https://another.com/story'}), false);

  // Test message origin authentication: Pikabu requests are Pikabu-only.
  const listener = listeners[0];
  assert.equal(listener({action:'download-pikabu',url:SRC},{url:'https://yapfiles.ru/get_player/?v=a'},()=>{}), false);
  let callback;
  const handled = listener({action:'download-pikabu',url:SRC}, {url:'https://pikabu.ru/story/test'},r=>{callback=r;});
  assert.equal(handled, true);
  for (let i=0; !callback && i<10; i++) await new Promise(r=>setImmediate(r));
  assert.equal(callback?.ok, true);
  assert.equal(downloaded.length, 2);
  console.log('OK: Pikabu source / preview exclusion / multiple qualities / safe sender / downloads');
}
tests().catch(error=>{console.error(error);process.exitCode=1;});
