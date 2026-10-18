"""v2 browser checks: layout at five sizes, preview badges, EQ effect on real audio, word-level lyrics, Replay.
Run: python3 tests/e2e_v2.py [base_url]"""
import sys, time, json, math
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5199"
R = []
def check(n, c, d=""): R.append(bool(c)); print(("PASS " if c else "FAIL ") + n + (f"  [{d}]" if d else ""))
def wait(pg, e, t=10):
    t0 = time.time()
    while time.time() - t0 < t:
        if pg.evaluate(e): return True
        time.sleep(0.1)
    return False
def signup(pg, name="Isaac"):
    pg.goto(BASE + "/"); pg.wait_for_selector("#auth-form"); pg.fill("#a-name", name); pg.click("#auth-form button"); pg.wait_for_selector(".greeting")
def play_test(pg, idx=0):
    pg.goto(BASE + "/#/search?q=test%20signal&source=test"); pg.wait_for_selector(".row")
    pg.locator(".row .r-play").nth(idx).dispatch_event("click"); wait(pg, "vesper.engine.state.status==='playing'")
BOX = """()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return b.width&&b.height?{x:b.x,y:b.y,r:b.right,b:b.bottom,w:b.width}:null};
 return {art:r('#np-art'),title:r('#np-title'),artist:r('#np-artist'),like:r('#np-like'),prog:r('.np-progress'),play:r('#np-play'),next:r('#np [data-act=next]'),tools:r('.np-tools'),vh:innerHeight,vw:innerWidth}}"""
ov = lambda a, b: a and b and not (a['r'] <= b['x'] or b['r'] <= a['x'] or a['b'] <= b['y'] or b['b'] <= a['y'])
with sync_playwright() as p:
    br = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    # 1. Layout at five sizes (plus a short Safari-with-toolbars height)
    for name, w, h in [("iPhone SE", 375, 667), ("iPhone SE with Safari bars", 375, 548), ("iPhone 15", 393, 852), ("iPhone Pro Max", 430, 932), ("Phone landscape", 852, 393), ("Desktop", 1440, 900)]:
        c = br.new_context(viewport={"width": w, "height": h}, is_mobile=w < 900, has_touch=w < 900); pg = c.new_page()
        signup(pg); play_test(pg); pg.evaluate("document.querySelector('[data-act=np-open]').click()"); time.sleep(1.2)
        b = pg.evaluate(BOX); bad = []
        for k in ['title', 'artist', 'like', 'prog', 'play', 'next', 'tools']:
            if not b[k]: bad.append(f"{k} missing"); continue
            if ov(b['art'], b[k]): bad.append(f"art covers {k}")
            if b[k]['b'] > b['vh'] + 1: bad.append(f"{k} below screen")
        small = [k for k in ['like', 'play', 'next'] if b[k] and b[k]['w'] < 43]
        check(f"Now Playing layout, {name} {w}x{h}: no overlap, all controls on screen", not bad, "; ".join(bad) or f"art {round(b['art']['w'])}px")
        if w < 900: check(f"Touch targets ≥ 44px, {name}", not small, ",".join(small))
        if name == "iPhone SE": 
            pg.screenshot(path="/tmp/v2_np_se.png")
            check("Preview/Full badge in Now Playing", pg.locator("#np-artist .badge").count() == 1 and "Full" in pg.inner_text("#np-artist .badge"))
        if name == "Phone landscape": pg.screenshot(path="/tmp/v2_np_land.png")
        c.close()

    c = br.new_context(viewport={"width": 1440, "height": 900}); pg = c.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    signup(pg); play_test(pg, 2)
    check("Compact player shows Full badge", pg.inner_text("#p-badge") == "Full" and pg.is_visible("#p-badge"))
    check("Queue items carry Preview/Full badges", pg.locator("#panel-body .q-item[data-key] .badge").count() == pg.locator("#panel-body .q-item[data-key]").count())

    # 2. EQ measurably changes the signal (spectral tilt: low vs high band energy at the analyser)
    # Low-band (40–160 Hz) energy at the output, averaged over 2 s from the same spot in the song.
    LOW = """async()=>{const a=vesper.engine.analyser,f=new Float32Array(a.frequencyBinCount),sr=vesper.engine.ctx.sampleRate;let s=0,n=0;
      vesper.engine.seek(10);await new Promise(r=>setTimeout(r,600));
      for(let k=0;k<40;k++){a.getFloatFrequencyData(f);let l=0,c=0;for(let i=1;i<f.length;i++){const hz=i*sr/(2*f.length);if(hz>=40&&hz<=160){l+=10**(f[i]/10);c++}}s+=l/c;n++;await new Promise(r=>setTimeout(r,50));}
      return 10*Math.log10(s/n);}"""
    pg.click(".player [data-act='audio-panel']"); pg.wait_for_selector("#audio-dialog[open]")
    pg.click("#audio-dialog [data-preset='bass']"); time.sleep(0.5)
    gains = pg.evaluate("vesper.engine.eqNodes.map(n=>Math.round(n.gain.value*10)/10)")
    check("EQ Bass Boost sets real filter gains", gains[0] > 5 and gains[9] == 0, str(gains))
    resp = pg.evaluate("Array.from(vesper.engine.eqResponse([60, 1000, 10000])).map(v=>Math.round(v*10)/10)")
    check("EQ Bass Boost: live filter response lifts bass", resp[0] - resp[1] >= 4, f"dB at 60 Hz/1k/10k: {resp}")
    boost = pg.evaluate(LOW)
    pg.evaluate("""()=>{for(const [i,v] of [[0,-6],[1,-6],[2,-4],[3,0],[4,0]]){const s=document.querySelector(`#audio-dialog [data-band="${i}"]`);s.value=String(v);s.dispatchEvent(new Event('input',{bubbles:true}));}}"""); time.sleep(0.5)
    cut = pg.evaluate(LOW)
    check("EQ audibly changes the real signal: bass boost vs bass cut at the output (≥ 4 dB)", boost - cut >= 4, f"40–160 Hz energy {cut:.1f} dB (cut) vs {boost:.1f} dB (boost)")
    check("Moving a band switches to Custom", pg.get_attribute("#audio-dialog [data-preset='custom']", "aria-checked") == "true")
    pg.click("#audio-dialog [data-preset='treble']"); time.sleep(0.4)
    resp = pg.evaluate("Array.from(vesper.engine.eqResponse([100, 1000, 8000, 14000])).map(v=>Math.round(v*10)/10)")
    check("EQ Treble Boost: live filter response rises toward treble", resp[2] - resp[0] >= 3 and resp[3] - resp[0] >= 4, f"dB at 100/1k/8k/14k: {resp}")
    pg.screenshot(path="/tmp/v2_eq.png")
    # move one band → custom; save preset; persists after reload
    pg.evaluate("""()=>{const s=document.querySelector('#audio-dialog [data-band="4"]'); s.value='5'; s.dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.evaluate("""()=>{const s=document.querySelector('#audio-dialog [data-band="4"]'); s.value='5'; s.dispatchEvent(new Event('input',{bubbles:true}));}""")
    pg.click("#audio-dialog [data-a='save']"); pg.wait_for_selector("#dialog[open] input"); pg.fill("#dialog input", "Night bass"); pg.click("#dialog button.primary"); time.sleep(1)
    check("Custom EQ preset saved", pg.locator("#audio-dialog .chip", has_text="Night bass").count() == 1)
    pg.click("#audio-dialog [data-a='close']"); time.sleep(0.6)
    pg.reload(); pg.wait_for_selector(".greeting, .page-title"); time.sleep(0.8)
    st = pg.evaluate("fetch('/api/me').then(r=>r.json()).then(j=>j.user.settings)")
    check("EQ settings and presets persist across sessions", st['eq']['enabled'] and st['eq']['bands'][4] == 5 and st['eqPresets'][0]['name'] == 'Night bass')
    pg.evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))"); time.sleep(0.3)
    check("Saved EQ re-applied to the engine after reload", pg.evaluate("vesper.engine.eqNodes && vesper.engine.eqNodes[4].gain.value > 3"))
    pg.evaluate("import('/js/store.js').then(m=>m.saveSettings({eq:{...m.store.settings.eq, enabled:false}}))"); time.sleep(0.4)

    # 3. Word-level lyrics (test signal 2 has word timestamps)
    play_test(pg, 1)
    pg.click(".player [data-act='panel-tab'][data-tab='lyrics']"); time.sleep(0.8)
    pg.evaluate("vesper.engine.pause()"); time.sleep(0.2); pg.evaluate("vesper.engine.seek(10.9)"); time.sleep(0.4)
    sung = pg.locator("#panel-body .line.now .w.sung").count(); total = pg.locator("#panel-body .line.now .w").count()
    check("Word-level highlight follows word timestamps", total == 5 and sung == 2, f"{sung}/{total} words sung, paused at 10.9 s (words at 10.0, 10.6, 11.2…; 0.15 s display lead)")
    pg.evaluate("vesper.engine.play()")
    play_test(pg, 0); pg.click(".player [data-act='panel-tab'][data-tab='lyrics']"); time.sleep(0.8)
    check("Line-only lyrics don't fake word timing", pg.locator("#panel-body .w").count() == 0 and pg.locator("#panel-body .line").count() > 0)

    # 4. Replay with recorded (non-test) events
    pg.evaluate("""async()=>{const t=(i,a,pv)=>({id:'dz:'+(9000+i),provider:'deezer',title:'Replay song '+i,artist:a,preview:pv,playable:true});
      const post=b=>fetch('/api/me/events',{method:'POST',headers:{'content-type':'application/json','x-vesper':'1'},body:JSON.stringify(b)});
      for(const [i,a,ms,pv] of [[1,'Artist One',25000,true],[1,'Artist One',22000,true],[2,'Artist Two',28000,true],[3,'Artist Three',5000,true]]) await post({track:t(i,a,pv),ms});}""")
    pg.goto(BASE + "/#/replay"); pg.wait_for_selector(".replay-card")
    pg.click(".replay-card"); pg.wait_for_selector("#story:not([hidden]) .story-card")
    first = pg.inner_text("#story-card")
    check("Replay opens story with real listening minutes", "minutes of music" in first, first.replace("\n", " ")[:80])
    pg.click("#story [data-s='pause']"); pg.click("#story [data-s='next']"); time.sleep(0.4)
    check("Replay top song card", "Replay song 1" in pg.inner_text("#story-card"))
    pg.screenshot(path="/tmp/v2_replay.png")
    for _ in range(12): pg.click("#story [data-s='next']"); time.sleep(0.05)
    honest = pg.evaluate("[...document.querySelectorAll('#story-card')].map(e=>e.innerText).join(' ')")
    pg.click("#story [data-s='prev']"); time.sleep(0.3)
    hn = pg.inner_text("#story-card")
    check("Replay honest-numbers card separates previews and brief starts", "3 preview listens" in hn and "1 brief start" in hn, hn.replace("\n", " ")[:120])
    blob = pg.evaluate("import('/js/replay.js').then(async m=>{const r=(await (await fetch('/api/me/replay/year/'+new Date().getUTCFullYear())).json()).replay; const c=await m.renderShareCanvas(r); return c.toDataURL('image/png').length})")
    check("Shareable Replay image renders", blob > 20000, f"{blob} bytes base64")
    pg.keyboard.press("Escape")
    check("Data export downloads profile JSON", pg.evaluate("fetch('/api/me/export').then(r=>r.json()).then(j=>!!j.profile && !('passHash' in j.profile) && Array.isArray(j.playlists))"))
    check("No uncaught page errors", not errs, "; ".join(errs[:2]))
    br.close()
print(f"\n{sum(R)}/{len(R)} checks passed"); sys.exit(0 if all(R) else 1)
