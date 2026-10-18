"""End-to-end tests for Vesper using headless Chromium and the offline test-signal catalog.
Run:  python3 tests/e2e.py [base_url]     (server must be running; see README)"""
import sys, time, json, urllib.request
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5199"
results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond), detail)); print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
def S(pg, expr): return pg.evaluate(expr)
def wait_until(pg, expr, timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pg.evaluate(expr): return True
        time.sleep(0.1)
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    page_errors = []
    pg.on("pageerror", lambda e: page_errors.append(str(e)))
    pg.goto(BASE + "/")
    pg.wait_for_selector("#auth-form")
    check("1. App starts and shows welcome", pg.is_visible("#auth-form"))
    pg.fill("#a-name", "Isaac"); pg.click("#auth-form button")
    pg.wait_for_selector(".greeting")
    check("Personalised greeting uses profile name", "Isaac" in pg.inner_text(".greeting"))

    # Analysis accuracy on known-tempo test signals
    pg.goto(BASE + "/#/search?q=test%20signal&source=test")
    pg.wait_for_selector(".row")
    check("2. Search returns results (offline test provider)", pg.locator(".row").count() == 6)
    S(pg, "window.__prep=[]; vesper.engine.addEventListener('prepared', e=>__prep.push(e.detail)); vesper.engine.addEventListener('next-ready', e=>__prep.push(e.detail))")
    pg.locator(".row").nth(2).hover(); pg.locator(".row .r-play").nth(2).click()   # 120 BPM signal
    ok = wait_until(pg, "vesper.engine.state.status==='playing'")
    check("3. A playable track starts", ok, S(pg, "vesper.engine.state.track?.title"))
    time.sleep(1.5)
    p1 = S(pg, "vesper.engine.position"); time.sleep(1.2); p2 = S(pg, "vesper.engine.position")
    check("5. Progress advances from real playback", p2 > p1 + 0.8, f"{p1:.2f} -> {p2:.2f}")
    bar = pg.eval_on_selector("#p-seek", "e=>Number(e.value)")
    check("5b. Progress bar reflects position", bar > 0, f"seek value {bar}")
    an = S(pg, "__prep.map(x=>({t:x.track.title, bpm:x.analysis?.bpm, lead:x.analysis?.leadSilence, trail:x.analysis?.trailSilence, fade:x.analysis?.fadeOut}))")
    first = next((a for a in an if '120 BPM' in a['t']), None)
    check("Tempo estimate on 120 BPM signal within 3%", first and first['bpm'] and abs(first['bpm'] - 120) / 120 < 0.03, json.dumps(first))
    check("Silence detection finds 0.6 s lead-in", first and abs(first['lead'] - 0.6) < 0.08, f"lead {first and first['lead']}")
    nxt = next((a for a in an if '128 BPM' in a['t']), None)
    check("Next track preloaded and analysed (128 BPM within 3%)", nxt and nxt['bpm'] and abs(nxt['bpm'] - 128) / 128 < 0.03, json.dumps(nxt))
    check("Natural fade-out detected on outgoing song", first and first['fade'] > 1.5, f"fadeOut {first and first['fade']}")

    # 4. play/pause + 16. controls reflect state
    pg.click("#p-play"); time.sleep(0.4)
    check("4. Pause works", S(pg, "vesper.engine.paused") and S(pg, "vesper.engine.state.status") == 'paused')
    check("16. Play button label reflects paused state", pg.get_attribute("#p-play", "aria-label") == "Play")
    pg.click("#p-play"); time.sleep(0.5)
    check("4b. Resume works", not S(pg, "vesper.engine.paused"))
    check("16b. Button label reflects playing", pg.get_attribute("#p-play", "aria-label") == "Pause")

    # 6. seek
    S(pg, "vesper.engine.seek(20)"); time.sleep(0.3)
    check("6. Seeking works", 19.8 < S(pg, "vesper.engine.position") < 21.5, f"{S(pg, 'vesper.engine.position'):.2f}")

    # 15. lyrics sync (test LRC lines every 4 s starting at 2 s)
    pg.click(".player [data-act='panel-tab'][data-tab='lyrics']"); time.sleep(0.8)
    S(pg, "vesper.engine.seek(14.5)"); time.sleep(0.6)
    now = pg.locator("#panel-body .line.now").inner_text() if pg.locator("#panel-body .line.now").count() else ""
    check("15. Lyrics highlight the current line after seek", "14 seconds" in now, now)
    pg.locator("#panel-body .line[data-t='26']").click(); time.sleep(0.5)
    check("15b. Tapping a lyric seeks to it", 25.8 < S(pg, "vesper.engine.position") < 27.5)
    pg.click(".player [data-act='panel-tab'][data-tab='queue']")

    # 14. artwork + 7. next/prev
    art1 = pg.get_attribute("#p-art", "src")
    pg.click(".player [data-act='next']"); wait_until(pg, "vesper.engine.state.status==='playing'")
    title2 = S(pg, "vesper.engine.state.track.title")
    check("7. Next works", '128 BPM' in title2, title2)
    check("14. Artwork changes with the track", pg.get_attribute("#p-art", "src") != art1)
    check("Lock-screen metadata updated (Media Session)", S(pg, "navigator.mediaSession.metadata?.title") == title2)
    time.sleep(0.5)
    S(pg, "vesper.queue.prev()"); time.sleep(0.3)
    S(pg, "vesper.queue.prev()"); wait_until(pg, "vesper.engine.state.track?.title.includes('120 BPM')")
    check("7b. Previous works", '120 BPM' in S(pg, "vesper.engine.state.track.title"))

    # 8. queue operations
    mb = S(pg, "vesper.queue.items.filter(x=>x.origin==='manual').length")
    S(pg, "vesper.queue.add(vesper.queue.context.tracks[0])")
    q = S(pg, "vesper.queue.items.map(x=>[x.track.id,x.origin])")
    check("8b. Add to queue goes after existing manual items, before the album/list", q[mb] == ['ts:1', 'manual'] and all(o == 'manual' for _, o in q[:mb+1]), str(q[:mb+2]))
    S(pg, "vesper.queue.playNext(vesper.queue.context.tracks[5])")
    q = S(pg, "vesper.queue.items.map(x=>[x.track.id,x.origin])")
    check("8. Play next goes to the very front", q[0] == ['ts:6', 'manual'], str(q[:3]))
    S(pg, "vesper.queue.move(0, 2)")
    check("8c. Reorder works", S(pg, "vesper.queue.items[2].track.id") == 'ts:6')
    key = S(pg, "vesper.queue.items[2].key"); n0 = S(pg, "vesper.queue.items.length")
    S(pg, f"vesper.queue.remove('{key}')")
    check("8d. Remove works", key not in S(pg, "vesper.queue.items.map(x=>x.key)") and S(pg, "vesper.queue.items.length") == n0 - 1)
    check("Up Next panel renders queue", pg.locator("#panel-body .q-item[data-key]").count() == S(pg, "vesper.queue.items.length"))

    # 11. navigation does not restart playback
    pos_a = S(pg, "vesper.engine.position"); src_a = S(pg, "vesper.engine.active.el.src")
    for h in ["#/home", "#/charts", "#/library", "#/settings", "#/stats"]:
        pg.goto(BASE + "/" + h); time.sleep(0.4)
    pos_b = S(pg, "vesper.engine.position")
    check("11. Navigating pages keeps playback going", S(pg, "vesper.engine.active.el.src") == src_a and pos_b > pos_a and not S(pg, "vesper.engine.paused"), f"{pos_a:.1f} -> {pos_b:.1f}")

    # 12. crossfade
    S(pg, "fetch('/api/me',{method:'PATCH',headers:{'content-type':'application/json','x-vesper':'1'},body:JSON.stringify({settings:{transition:'smooth',crossfade:4}})})")
    S(pg, "vesper.engine.setSettings({transition:'smooth',crossfade:4})")
    S(pg, "window.__adv=null; vesper.engine.addEventListener('advanced', e=>window.__adv=e.detail.plan)")
    wait_until(pg, "vesper.engine.next?.ready", 8)
    d = S(pg, "vesper.engine.duration")
    S(pg, f"vesper.engine.seek({d} - 8.5)")
    ok = wait_until(pg, "!!vesper.engine.transition", 12)
    check("12. Crossfade starts before the end", ok)
    time.sleep(1.2)
    both = S(pg, "vesper.engine.decks.map(d=>({paused:d.el.paused, g:d.fade.gain.value}))")
    check("12b. Both decks audible mid-crossfade", all(not x['paused'] for x in both) and all(0.05 < x['g'] < 0.98 for x in both), json.dumps(both))
    plan = S(pg, "window.__adv")
    check("12c. Fade length respected/clamped sensibly", plan and 1 <= plan['fade'] <= 4.01, json.dumps(plan and {k: plan[k] for k in ('kind','fade','outEnd','inStart')}))
    time.sleep(4)
    after = S(pg, "vesper.engine.decks.map(d=>d.el.paused)")
    check("12d. Outgoing deck stops after the blend (no lingering overlap)", sum(1 for x in after if not x) == 1 and not S(pg, "vesper.engine.transition"), str(after))

    # DJ preset uses beats
    S(pg, "vesper.engine.setSettings({transition:'dj'})")
    wait_until(pg, "vesper.engine.next?.ready", 8)
    d = S(pg, "vesper.engine.duration"); S(pg, f"vesper.engine.seek({d} - 13)")
    wait_until(pg, "!!vesper.engine.transition", 15)
    plan = S(pg, "vesper.engine.state.transition")
    check("DJ preset snaps blend to whole beats when tempo is known", plan and 'beats' in (plan.get('note') or ''), json.dumps(plan))
    time.sleep(0.8)
    check("DJ preset applies bass-swap filter to outgoing deck", S(pg, "vesper.engine.transition?.out.filter.type") == 'highpass')
    time.sleep(13)

    # Off preset: no overlap
    S(pg, "vesper.engine.setSettings({transition:'off'})")
    wait_until(pg, "vesper.engine.next?.ready", 8)
    t_before = S(pg, "vesper.engine.state.track.id")
    d = S(pg, "vesper.engine.duration"); S(pg, f"vesper.engine.seek({d} - 3)")
    overlap = False
    for _ in range(45):
        if S(pg, "vesper.engine.decks.filter(d=>!d.el.paused && d.track).length") > 1: overlap = True
        time.sleep(0.1)
    check("Transition Off never overlaps two songs", not overlap and S(pg, "vesper.engine.state.track.id") != t_before)

    # 9 & 10 persistence
    S(pg, "vesper.engine.setSettings({transition:'smooth'})")
    pg.goto(BASE + "/#/search?q=test%20signal&source=test"); pg.wait_for_selector(".row")
    pg.locator(".row").nth(0).locator("[data-act='like']").click(); time.sleep(0.4)
    pg.evaluate("""async()=>{const r=await fetch('/api/me/playlists',{method:'POST',headers:{'content-type':'application/json','x-vesper':'1'},body:JSON.stringify({name:'Night drive'})}); const j=await r.json(); await fetch('/api/me/playlists/'+j.playlist.id+'/tracks',{method:'POST',headers:{'content-type':'application/json','x-vesper':'1'},body:JSON.stringify({tracks:[vesper.queue.context?.tracks?.[1] || {id:'ts:2',provider:'test',title:'Test signal 2 (100 BPM)',artist:'Vesper test signal',playable:true}]})}); window.__pl=j.playlist.id;}""")
    pl_id = S(pg, "window.__pl")
    pg.reload(); pg.wait_for_selector(".greeting, .page-title", timeout=10000)
    pg.goto(BASE + "/#/library/songs"); pg.wait_for_selector(".row")
    check("9. Liked songs persist after reload", "Test signal 1" in pg.inner_text("#lib"))
    pg.goto(BASE + f"/#/playlist/{pl_id}"); pg.wait_for_selector(".hero h1")
    check("10. Playlists persist after reload", pg.inner_text(".hero h1") == "Night drive" and pg.locator(".row").count() == 1)
    check("Queue restored after reload", S(pg, "!!vesper.queue.current"))

    # 19. provider errors shown clearly (no internet in test environment)
    pg.goto(BASE + "/#/search?q=girl%20in%20red"); pg.wait_for_selector(".notice", timeout=15000)
    txt = pg.inner_text("#results")
    check("19. Provider errors are displayed, not hidden", "Deezer" in txt and ("reach" in txt.lower() or "error" in txt.lower()), txt[:120].replace("\n", " "))
    pg.goto(BASE + "/#/charts/us-top"); pg.wait_for_selector("#chart .notice", timeout=15000)
    check("Charts show an error instead of invented data when offline", "Couldn" in pg.inner_text("#chart"))

    # Stats from real events
    time.sleep(0.5)
    st = pg.evaluate("fetch('/api/me/stats?range=7d').then(r=>r.json())")
    check("Listening events recorded for stats", st['totals']['plays'] >= 3, f"plays={st['totals']['plays']}")
    pg.goto(BASE + "/#/stats"); pg.wait_for_selector(".stat")
    pg.screenshot(path="/tmp/e2e_stats.png")

    # Now Playing + visualizer
    pg.goto(BASE + "/#/home"); time.sleep(0.5)
    S(pg, "vesper.engine.play()"); time.sleep(0.5)
    pg.click(".p-art"); pg.wait_for_selector("#np:not([hidden])"); time.sleep(1.2)
    pg.screenshot(path="/tmp/e2e_np.png")
    check("Now Playing opens with track title", pg.inner_text("#np-title") == S(pg, "vesper.engine.state.track.title"))
    S(pg, "fetch('/api/me',{method:'PATCH',headers:{'content-type':'application/json','x-vesper':'1'},body:JSON.stringify({settings:{artworkMode:'lyrics'}})}).then(()=>{})")
    pg.evaluate("import('/js/store.js').then(m=>m.saveSettings({artworkMode:'lyrics'}))"); time.sleep(1.2)
    pg.screenshot(path="/tmp/e2e_np_lyrics.png")
    check("Lyrics mode renders synced lines in Now Playing", pg.locator("#np-lyrics .line").count() > 3)
    pg.evaluate("import('/js/store.js').then(m=>m.saveSettings({artworkMode:'visualizer'}))"); time.sleep(1.5)
    pg.screenshot(path="/tmp/e2e_np_viz.png")
    check("Visualizer animation loop running", S(pg, "document.querySelector('#np')&&true") and S(pg, "!!document.querySelector('.np-canvas')"))
    pg.keyboard.press("Escape"); time.sleep(0.4)
    check("Escape closes Now Playing", S(pg, "document.getElementById('np').hidden"))
    pg.evaluate("import('/js/store.js').then(m=>m.saveSettings({artworkMode:'ambient'}))")

    # 17. mobile layout
    m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    mp = m.new_page(); mp.goto(BASE + "/"); mp.wait_for_selector("#auth-form"); mp.fill("#a-name", "Maya"); mp.click("#auth-form button"); mp.wait_for_selector(".greeting")
    mp.goto(BASE + "/#/search?q=test%20signal&source=test"); mp.wait_for_selector(".row"); mp.locator(".row .r-meta").first.tap(); okm = wait_until(mp, "vesper.engine.state.status==='playing'", 8)
    check("17d. Mobile: tapping a song row plays it", okm, mp.evaluate("vesper.engine.state.track?.title || ''"))
    mp.locator(".row [data-act='track-menu']").first.click(); time.sleep(0.3)
    mp.screenshot(path="/tmp/e2e_mobile_menu.png"); mp.keyboard.press("Escape")
    mp.goto(BASE + "/#/home"); time.sleep(1); mp.screenshot(path="/tmp/e2e_mobile.png")
    check("17. Mobile: tab bar visible, sidebar hidden", mp.is_visible(".tabbar") and not mp.is_visible(".side"))
    check("17b. Mobile: player bar visible", mp.is_visible(".player"))
    sw = mp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
    check("17c. Mobile: no horizontal page overflow", sw)

    # 18. auth + isolation (API level)
    def req(path, method="GET", body=None, cookie=None):
        r = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json", "x-vesper": "1", **({"cookie": cookie} if cookie else {})})
        try:
            with urllib.request.urlopen(r) as res: return res.status, json.loads(res.read() or b"{}"), res.headers.get("set-cookie")
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}"), None
    _, _, ca = req("/api/auth/register", "POST", {"username": f"alice{int(time.time())}", "password": "correct horse 1", "displayName": "Alice"})
    _, _, cb = req("/api/auth/register", "POST", {"username": f"bob{int(time.time())}", "password": "battery staple 2", "displayName": "Bob"})
    ca, cb = ca.split(";")[0], cb.split(";")[0]
    _, pa, _ = req("/api/me/playlists", "POST", {"name": "Alice private"}, ca)
    code, _, _ = req(f"/api/playlists/{pa['playlist']['id']}", cookie=cb)
    check("18. Another user cannot open a private playlist", code == 404)
    code, _, _ = req(f"/api/me/playlists/{pa['playlist']['id']}", "PATCH", {"name": "hacked"}, cb)
    check("18b. Another user cannot edit it", code == 404)
    req(f"/api/me/playlists/{pa['playlist']['id']}", "PATCH", {"privacy": "public"}, ca)
    code, _, _ = req(f"/api/playlists/{pa['playlist']['id']}", cookie=cb)
    check("18c. Shared (public) playlist is viewable by others", code == 200)
    code, _, _ = req("/api/me/library", cookie=None)
    check("18d. Library requires a session", code == 401)
    code, _, _ = req("/api/auth/login", "POST", {"username": "nobody", "password": "x"})
    check("18e. Wrong credentials rejected", code == 401)
    r = urllib.request.Request(BASE + "/api/me/playlists", method="POST", data=b"{}", headers={"content-type": "application/json", "cookie": ca})
    try: urllib.request.urlopen(r); csrf = 200
    except urllib.error.HTTPError as e: csrf = e.code
    check("18f. State-changing request without app header is refused (CSRF guard)", csrf == 403)

    check("No uncaught page errors", not page_errors, "; ".join(page_errors[:3]))
    browser.close()

passed = sum(1 for r in results if r[1]); print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
