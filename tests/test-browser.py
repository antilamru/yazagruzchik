from pathlib import Path
from playwright.sync_api import sync_playwright

SRC = 'https://cs3.pikabu.ru/s/2026/10/23/17/7gt7bvw2_s0f0d10m0_720x1280_low.mp4'
PREVIEW = 'https://cs3.pikabu.ru/s/2026/10/23/17/7gt7bvw2_s0f0d10m0_720x1280_preview.mp4'
root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1300, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content('''<style>[data-role=player]{position:relative;width:400px;height:180px;background:#123;margin:20px;display:inline-block}</style>
    <div class="story-block story-block_type_video"><div data-role="player" data-type="video-file" id="v1">
      <div data-role="container">
        <div data-role="player-controls"><video class="pkb-player-timeline__preview--Tj47lFYH" src="'''+PREVIEW+'''" preload="none"></video></div>
        <video data-video-player="1" preload="none"><source src="'''+SRC+'''" type="video/mp4"></video>
      </div></div></div>
    <div data-role="player" data-type="video-file" id="v2"><div data-role="container"><video data-video-player="1" preload="none"><source src="https://cs3.pikabu.ru/another_high.mp4"></video></div></div>
    ''')
    page.evaluate('''() => {
        window.__downloads=[];
        window.chrome={runtime:{id:'test-extension',lastError:null,sendMessage:(msg,fn)=>{window.__downloads.push(msg);fn({ok:true,downloadId:100});}}};
    }''')
    page.add_script_tag(path=str(root/'pikabu-content.js'))
    page.wait_for_selector('#v1 [data-yazagruzchik="player"]')
    assert page.locator('[data-yazagruzchik="player"]').count() == 2
    assert not errors, errors
    def click_main(pid):
        box = page.locator('#'+pid+' [data-yazagruzchik]').bounding_box()
        page.mouse.click(box['x']+35,box['y']+16)
    click_main('v1')
    page.wait_for_function('window.__downloads.length === 1')
    assert page.evaluate('window.__downloads[0].url') == SRC, page.evaluate('window.__downloads')
    click_main('v2')
    page.wait_for_function('window.__downloads.length === 2')
    assert page.evaluate('window.__downloads[1].url') == 'https://cs3.pikabu.ru/another_high.mp4'
    page.evaluate('''() => {
        const div = document.createElement('div');
        div.setAttribute('data-role', 'player'); div.setAttribute('data-type','video-file');
        div.id = 'v3'; div.innerHTML='<div data-role="container"><video data-video-player="1" preload="none"><source src="https://cs3.pikabu.ru/new_clip_low.mp4"></video></div>';
        document.body.append(div);
    }''')
    page.wait_for_selector('#v3 [data-yazagruzchik]')
    assert page.locator('[data-yazagruzchik="player"]').count() == 3
    # Don't accidentally mount another control when updating the source within an existing player.
    page.evaluate('''() => document.querySelector('#v1 source').src='https://cs3.pikabu.ru/new_high.mp4' ''')
    page.wait_for_timeout(100)
    assert page.locator('#v1 [data-yazagruzchik="player"]').count() == 1
    click_main('v1')
    page.wait_for_function('window.__downloads.length === 3')
    assert page.evaluate('window.__downloads[2].url') == 'https://cs3.pikabu.ru/new_high.mp4', page.evaluate('window.__downloads')
    assert not errors, errors
    print('OK: browser DOM player controls / multiple videos / preview exclusion / Vue dynamic insertion / quality switching')
    browser.close()
