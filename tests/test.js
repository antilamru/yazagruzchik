'use strict';
const assert = require('node:assert/strict');
let files = [];
global.chrome = {
  runtime: { onMessage: { addListener(){} } },
  downloads: { async download(opts){files.push(opts);return 42;} }
};
const {resolveVideo, startDownload, cleanTitle, isVideoUrl, parseHttpUrl, makeCollector} = require('../background.js');

const VIDEO_ID = 'vMDM3ODYxOTYtc5b2';
const json = (body) => ({
  ok: true,
  headers: { get: () => null },
  text: async () => JSON.stringify(body)
});
const route = (routes) => {
  global.fetch = async (url) => {
    const exact = routes.find(r => url.includes(r[0]));
    if (!exact) throw new Error(`Not mocked: ${url}`);
    if (exact[1] instanceof Error) throw exact[1];
    return json(exact[1]);
  };
};

async function test() {
  assert.equal(cleanTitle('Видеоролик: праздник / 2026? '), 'Видеоролик праздник 2026');
  assert.equal(isVideoUrl('https://cdn.example.com/file.mp4?hash=1'), true);
  assert.equal(isVideoUrl('https://cdn.example.com/file.m3u8'), false);
  assert.equal(parseHttpUrl('javascript:alert(1)'), null);

  route([
    ['/init/new.json', {player:{title:'Смешной ролик', playlist:'https://api.yapfiles.ru/playlist/123.json'}}],
    ['/playlist/123.json', {player:{main:{file:'https://cdn.example.com/a.mp4',file_hd:'https://cdn.example.com/b.mp4'}}}]
  ]);
  const data = await resolveVideo({videoId: VIDEO_ID,initUrls:['https://api.yapfiles.ru/init/new.json']});
  assert.deepEqual(data.formats.map(f=>f.quality), ['HD', 'SD']);
  assert.equal(data.title, 'Смешной ролик');
  assert.equal(data.formats[0].url, 'https://cdn.example.com/b.mp4');

  await startDownload({videoId:VIDEO_ID,title:data.title,format:data.formats[0]});
  assert.equal(files.at(-1).url,'https://cdn.example.com/b.mp4');
  assert.equal(files.at(-1).saveAs, false);
  assert.equal(files.at(-1).filename.includes('/'), false);
  assert.match(files.at(-1).filename,/^Смешной ролик_vMDM3ODYxOTYtc5b2_HD\.mp4$/);

  route([
    ['/bad',new Error('failed')],
    ['/load/',{player:{title:'Восстановлено',main:{file:'https://cdn.example.com/source.mp4'}}}]
  ]);
  const recovered = await resolveVideo({videoId:VIDEO_ID,initUrls:['https://api.yapfiles.ru/bad']});
  assert.equal(recovered.formats.length,1);
  assert.equal(recovered.title,'Восстановлено');

  route([['/load/',new Error('offline')]]);
  const observed = await resolveVideo({videoId:VIDEO_ID, observed:[
    {url:'https://video.example.com/real.mp4?sig=abcd',quality:'MP4'},
    {url:'https://video.example.com/advert-banner.mp4',quality:'MP4'}
  ]});
  assert.equal(observed.formats.length,1);
  assert.equal(observed.formats[0].source,'player');
  assert.equal(observed.formats[0].url,'https://video.example.com/real.mp4?sig=abcd');

  route([['/load/',{player:{title:'Test',playlist:'https://api.yapfiles.ru/playlist/hls'}}],
    ['/playlist/hls',{player:{main:{file:'https://video.example.com/movie.m3u8'}}}]]);
  const hls = await resolveVideo({videoId:VIDEO_ID});
  assert.equal(hls.formats.length,0);
  assert.match(hls.reason,/HLS\/DASH/);

  await assert.rejects(startDownload({videoId:VIDEO_ID,title:'bad',format:{url:'javascript:alert(0)',source:'api'}}));

  // Regression: YapFiles IDs are not always prefixed with 'v'.
  const hVideoId = 'hMDM3ODY0MDYt4442';
  route([['/load/',{player:{title:'Второй ролик',main:{file:'https://cdn.example.com/second.mp4'}}}]]);
  const other = await resolveVideo({videoId:hVideoId});
  assert.equal(other.formats.length, 1);
  await startDownload({videoId:hVideoId, title:other.title, format:other.formats[0]});
  assert.equal(files.at(-1).filename, 'Второй ролик_hMDM3ODY0MDYt4442_SD.mp4');
  assert.equal(files.at(-1).filename.includes('/'), false);
  const content = require('node:fs').readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
  const vm = require('node:vm');
  // Execute the iframe content script with mock DOM and assert that it mounts the control.
  function buttonVisibleFor(videoId) {
    let mounted = false;
    const element = () => ({ style: {}, setAttribute(){}, addEventListener(){},
      querySelector(){ return element(); }, replaceChildren(){}, append(){},
      attachShadow(){ return element(); } });
    const document = { getElementById(){return null;}, createElement:element,
      documentElement: {append(){mounted = true;}}, querySelectorAll(){return [];} };
    const context = { URL, location:{href:'https://api.yapfiles.ru/get_player/?v='+videoId},
      document, PerformanceObserver:class {observe(){}}, setTimeout, clearTimeout };
    vm.runInNewContext(content, context);
    return mounted;
  }
  assert.equal(buttonVisibleFor(VIDEO_ID), true);
  assert.equal(buttonVisibleFor(hVideoId), true);
  assert.equal(buttonVisibleFor('!!!'), false);
  const c = makeCollector();
  c.visit({player:{title:'Example', main:{file:'https://cdn.example.com/cdn-id-123'}}});
  assert.equal(c.result().formats.length,1);
  await startDownload({videoId:VIDEO_ID,title:'Example',format:c.result().formats[0]});
  assert.ok(files.at(-1).filename.endsWith('.mp4'));

  console.log('OK: extraction / HD / SD / fallback / HLS / download destination / new video IDs / sanitization');
}
test().catch(err => {console.error(err);process.exitCode=1;});
