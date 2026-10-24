"""Headless browser tests for team review: comments with @names and resolve, assigned to me, merging
a teammate's markup file with a conflict review, shared folder sync, and a live session between two
browser contexts connected by copying codes on localhost."""

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser import App, app, plan_pt, server  # noqa: E402,F401

playwright_api = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def browser():
    with playwright_api.sync_playwright() as p:
        try:
            # Local network addresses stay visible to the page so two contexts on one machine can connect
            # without an mDNS responder (containers usually have none).
            b = p.chromium.launch(args=["--disable-features=WebRtcHideLocalIpsWithMdns"])
        except Exception as e:  # no browser installed
            pytest.skip(f"Chromium is not available: {e}")
        yield b
        b.close()


def set_name_and_switches(a, name, live=False):
    pg = a.page
    pg.click("#menu-file")
    pg.click(".menu-list button:has-text('Settings')")
    pg.fill("#set-author", name)
    if live:
        pg.check("#set-net-live")
    pg.click("#set-save")
    pg.wait_for_timeout(100)


def draw_count(a, pts):
    a.key("Shift+Alt+C")
    for p in pts:
        a.click_pt(plan_pt(*p))
    a.key("Enter")
    return a.markups()[-1]


def test_comments_assignment_resolve_and_status_history(app):
    pg = app.page
    set_name_and_switches(app, "Ana")
    app.floor_plan()
    pg.click("#suggest-apply")
    m = draw_count(app, [(3, 3), (4, 4)])
    assert m["rev"] == 2 and len(m["vers"]) == 2 and m["modified_by"] == "Ana"  # created, then one more item counted
    app.key("Escape")
    app.click_pt(plan_pt(3, 3))
    pg.wait_for_selector("#prop-comments")
    pg.fill("#comment-text", "@Ben please check the count")
    pg.click("#comment-post")
    pg.wait_for_selector("#comment-thread .mention")
    assert pg.inner_text("#comment-thread .mention") == "@Ben"
    pg.click("#comment-thread button[data-reply]")
    pg.fill("#comment-text", "Counted twice by mistake?")
    pg.keyboard.press("Control+Enter")
    pg.wait_for_selector("#comment-thread .cm.d1")
    pg.fill("#prop-assignee", "Ben")
    pg.press("#prop-assignee", "Tab")
    pg.select_option("#prop-status", "Review")
    pg.wait_for_selector("#status-log")
    got = [x for x in app.markups() if x["id"] == m["id"]][0]
    assert [c["text"] for c in got["comments"]] == ["@Ben please check the count", "Counted twice by mistake?"]
    assert got["comments"][1]["reply_to"] == got["comments"][0]["id"]
    assert got["assignee"] == "Ben" and got["status_log"][-1]["status"] == "Review" and got["status_log"][-1]["by"] == "Ana"
    assert got["rev"] >= 4 and len(got["vers"]) == got["rev"]
    # Assigned to me: as Ana nothing; as Ben the markup
    pg.click("#tab-list")
    pg.check("#list-mine")
    pg.wait_for_timeout(200)
    assert pg.inner_text("#list-count").startswith("0 markups")
    set_name_and_switches(app, "Ben")
    pg.click("#list-mine")
    pg.click("#list-mine")
    pg.wait_for_timeout(200)
    assert pg.inner_text("#list-count").startswith("1 markup")
    # resolving takes it off Ben's list only if he is not the assignee; clear the assignee and resolve
    app.click_pt(plan_pt(3, 3))
    pg.fill("#prop-assignee", "")
    pg.press("#prop-assignee", "Tab")
    pg.click("#comment-resolve")
    pg.wait_for_timeout(200)
    pg.click("#list-mine")
    pg.click("#list-mine")
    pg.wait_for_timeout(200)
    assert pg.inner_text("#list-count").startswith("0 markups")
    assert [x for x in app.markups() if x["id"] == m["id"]][0]["resolved"] is True


def test_merge_a_teammates_file_with_a_conflict_review(app, tmp_path):
    pg = app.page
    set_name_and_switches(app, "Ana")
    app.floor_plan()
    pg.click("#suggest-apply")
    m = draw_count(app, [(3, 3)])
    with pg.expect_download() as dl:
        app.key("Control+s")
    mine_file = json.loads(Path(dl.value.path()).read_text())
    # Ben's copy: he moved the same markup and added one; meanwhile Ana moves it too
    theirs = json.loads(json.dumps(mine_file))
    tm = [x for x in theirs["markups"] if x["id"] == m["id"]][0]
    tm["points"] = [[tm["points"][0][0] + 30, tm["points"][0][1]]]
    tm["vers"] = tm["vers"] + ["ben1"]
    tm["rev"] = 2
    tm["modified_by"] = "Ben"
    tm["comments"] = [{"id": "cb1", "author": "Ben", "at": "2026-10-22T10:00:00Z", "text": "Moved to the door"}]
    theirs["markups"].append({"id": "ben-new", "type": "count", "page": 1, "points": [[300, 300]], "subject": "Ben's count", "vers": ["b1"], "rev": 1})
    app.key("Escape")
    app.click_pt(plan_pt(3, 3))
    app.key("ArrowRight")
    pg.wait_for_timeout(100)
    pg.set_input_files("#file-merge", files=[{"name": "plans.ben.markups.json", "mimeType": "application/json", "buffer": json.dumps(theirs).encode()}])
    pg.wait_for_selector("#merge-conflicts", timeout=10000)
    assert "1 new" in pg.inner_text("#merge-summary") and "1 to decide" in pg.inner_text("#merge-summary")
    assert "Both of you changed it" in pg.inner_text("#merge-conflicts")
    pg.click("#merge-0-both")
    pg.click("#merge-apply")
    ids = sorted(x["id"] for x in app.markups())
    assert ids == sorted([m["id"], m["id"] + ".2", "ben-new"])
    copy = [x for x in app.markups() if x["id"] == m["id"] + ".2"][0]
    assert copy["modified_by"] == "Ben" and any(c["id"] == "cb1" for c in copy.get("comments", []))  # their copy keeps their thread
    app.key("Control+z")
    pg.wait_for_timeout(100)
    assert [x["id"] for x in app.markups()] == [m["id"]]
    # merging the same file again with Keep theirs takes Ben's version
    pg.set_input_files("#file-merge", files=[{"name": "plans.ben.markups.json", "mimeType": "application/json", "buffer": json.dumps(theirs).encode()}])
    pg.wait_for_selector("#merge-conflicts")
    pg.click("#merge-0-theirs")
    pg.click("#merge-apply")
    got = [x for x in app.markups() if x["id"] == m["id"]][0]
    assert got["points"] == tm["points"] and got["modified_by"] == "Ben"
    assert any(c["id"] == "cb1" for c in got["comments"])  # comments from both sides survive


OPFS_PICKER = """
window.showDirectoryPicker = async () => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('shared', { create: true });
};
"""


def test_shared_folder_sync_writes_mine_and_merges_theirs(browser, server):
    a = App(browser, server)
    try:
        pg = a.page
        pg.add_init_script(OPFS_PICKER)
        pg.evaluate(OPFS_PICKER)
        set_name_and_switches(a, "Ana")
        a.floor_plan()
        pg.click("#suggest-apply")
        draw_count(a, [(3, 3)])
        pg.click("#menu-team")
        pg.click(".menu-list button:has-text('Shared folder sync')")
        pg.click("#sync-choose")
        pg.wait_for_selector("#sync-chip", timeout=10000)
        files = pg.evaluate("""async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shared');
            const out = []; for await (const [n] of d.entries()) out.push(n); return out; }""")
        assert files == ["example-plans.ana.markups.json"]
        doc_id = pg.evaluate("""async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shared');
            const f = await (await d.getFileHandle('example-plans.ana.markups.json')).getFile(); return JSON.parse(await f.text()).document.sha256; }""")
        ben = {"format": "field-tools-takeoff-markups", "version": 1, "document": {"name": "example-plans.pdf", "sha256": doc_id},
               "markups": [{"id": "ben-1", "type": "count", "page": 1, "points": [[400, 400]], "subject": "From Ben", "vers": ["b1"], "rev": 1}]}
        other_pdf = dict(ben, document={"name": "other.pdf", "sha256": "0" * 64}, markups=[dict(ben["markups"][0], id="wrong-pdf")])
        pg.evaluate("""async ([a, b]) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shared');
            for (const [n, t] of [['example-plans.ben.markups.json', a], ['other.carl.markups.json', b]]) {
              const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); } }""",
                    [json.dumps(ben), json.dumps(other_pdf)])
        # hostile neighbors in the shared folder: a folder named like a markup file, a file that is not
        # JSON, a flood of markups, prototype keys, and a file larger than the 50 MB limit
        flood = {"format": "field-tools-takeoff-markups", "version": 1, "document": {"name": "x.pdf", "sha256": "f" * 64},
                 "markups": [{"id": "q%d" % i, "type": "count", "page": 0, "points": [[1, 1]]} for i in range(120000)]}
        proto = json.loads(json.dumps(ben).replace('"markups"', '"__proto__": {"polluted": 1}, "constructor": {"x": 1}, "markups"'))
        proto["markups"][0]["id"] = "ben-2"
        pg.evaluate("""async ([flood, proto]) => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('shared');
            await d.getDirectoryHandle('folder.ana.markups.json', { create: true });
            const put = async (n, t) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); };
            await put('bad.dan.markups.json', '{"format": ');
            await put('flood.eve.markups.json', flood);
            await put('__proto__.fay.markups.json', proto);
            const w = await (await d.getFileHandle('huge.gus.markups.json', { create: true })).createWritable();
            await w.write(new Uint8Array(51 * 1024 * 1024)); await w.close(); }""", [json.dumps(flood), json.dumps(proto)])
        pg.click("#sync-chip")
        pg.click("#sync-now")
        t = time.time()
        while time.time() - t < 10 and "ben-1" not in [m["id"] for m in a.markups()]:
            pg.wait_for_timeout(200)
        t = time.time()
        while time.time() - t < 10 and "ben-2" not in [m["id"] for m in a.markups()]:
            pg.wait_for_timeout(200)
        ids = [m["id"] for m in a.markups()]
        assert "ben-1" in ids and "ben-2" in ids and "wrong-pdf" not in ids
        assert len(ids) < 1000, "a file for another PDF is read but not merged"
        assert "Merged" in pg.inner_text(".toast")
        assert pg.evaluate("() => ({}).polluted") is None
        assert "stopped" not in a.msg() and pg.locator("#sync-chip").count() == 1
        assert a.errors == []
    finally:
        a.close()


def live_app(browser, server, name):
    a = App(browser, server)
    set_name_and_switches(a, name, live=True)
    a.floor_plan()
    return a


def test_live_session_two_peers_on_localhost(browser, server):
    host, guest = live_app(browser, server, "Ana"), live_app(browser, server, "Ben")
    try:
        hp, gp = host.page, guest.page
        hp.click("#menu-team")
        hp.click(".menu-list button:has-text('Start a live session')")
        hp.wait_for_selector("#live-offer-code", timeout=20000)
        offer = hp.input_value("#live-offer-code")
        assert offer.startswith("SL1.") and hp.locator(".codebox svg.qr path.qr-fg").count() == 1
        gp.click("#menu-team")
        gp.click(".menu-list button:has-text('Join a live session')")
        gp.fill("#live-join-code", offer)
        gp.click("#live-join-go")
        gp.wait_for_selector("#live-answer-code", timeout=20000)
        assert gp.locator("#live-pdf-warn").count() == 0
        answer = gp.input_value("#live-answer-code")
        hp.fill("#live-answer-in", answer)
        hp.click("#live-connect")
        hp.wait_for_selector("#live-people li.peer .fp", timeout=20000)
        gp.keyboard.press("Escape")
        gp.click("#live-chip")
        gp.wait_for_selector("#live-people li.peer .fp", timeout=20000)
        fp_h = hp.inner_text("#live-people li.peer .fp")
        fp_g = gp.inner_text("#live-people li.peer .fp")
        assert fp_h == fp_g and len(fp_h.split()) == 4
        assert "Ben" in hp.inner_text("#live-people") and "Ana" in gp.inner_text("#live-people")
        # a markup drawn by the host appears for the guest; the guest's comment comes back
        hp.click("#suggest-apply")
        host.key("Shift+Alt+L")
        host.click_pt(plan_pt(0, 0))
        host.click_pt(plan_pt(10, 0))
        mid = host.markups()[-1]["id"]
        t = time.time()
        while time.time() - t < 10 and mid not in [m["id"] for m in guest.markups()]:
            gp.wait_for_timeout(150)
        assert mid in [m["id"] for m in guest.markups()]
        # the host's cursor shows on the guest's sheet with the host's name
        x, y = host.client(plan_pt(20, 10))
        for k in range(5):
            hp.mouse.move(x + k * 3, y)
            hp.wait_for_timeout(80)
        gp.wait_for_selector(".live-cursor", timeout=5000)
        assert "Ana" in gp.text_content("#ov-screen")
        guest.click_pt(plan_pt(5, 0))
        gp.wait_for_selector("#prop-comments")
        gp.fill("#comment-text", "@Ana is this the right wall?")
        gp.click("#comment-post")
        t = time.time()
        while time.time() - t < 10 and not [m for m in host.markups() if m["id"] == mid and m.get("comments")]:
            hp.wait_for_timeout(150)
        hm = [m for m in host.markups() if m["id"] == mid][0]
        assert hm["comments"][0]["text"] == "@Ana is this the right wall?" and hm["comments"][0]["author"] == "Ben"
        # the guest's markups never undo the host's work: Ctrl+Z on the host removes only its own last step
        # lock: the guest's changes stay on the guest's device
        hp.click("#live-lock")
        gp.wait_for_timeout(500)
        assert hp.locator("#live-lock").get_attribute("aria-pressed") == "true"
        assert "Locked by the host" in gp.inner_text("#live-panel")
        guest.key("Shift+Alt+C")
        guest.click_pt(plan_pt(8, 8))
        guest.key("Enter")
        gid = guest.markups()[-1]["id"]
        hp.wait_for_timeout(1000)
        assert gid not in [m["id"] for m in host.markups()]
        # the guest leaves; the host sees it
        gp.click("#live-chip")
        gp.click("#live-leave")
        t = time.time()
        while time.time() - t < 10 and hp.locator("#live-people li.peer").count():
            hp.wait_for_timeout(150)
        assert hp.locator("#live-people li.peer").count() == 0
        # no web requests left the machine
        for a in (host, guest):
            assert [u for u in a.requests if not (u.startswith(server) or u.startswith("blob:") or u.startswith("data:"))] == []
        assert host.errors == [] and guest.errors == []
    finally:
        host.close()
        guest.close()


def test_live_session_is_blocked_while_the_switch_is_off(browser, server):
    a = App(browser, server)
    try:
        pg = a.page
        pg.click("#menu-team")
        pg.click(".menu-list button:has-text('Start a live session')")
        pg.wait_for_selector("#live-switch-on")
        assert pg.evaluate("() => document.getElementById('live-offer-code')") is None
        assert a.requests and all(u.startswith(a.server) or u.startswith("blob:") or u.startswith("data:") for u in a.requests)
    finally:
        a.close()


CAPTURE_CHANNELS = """
(() => {
  const make = RTCPeerConnection.prototype.createDataChannel;
  window.__dcs = [];
  RTCPeerConnection.prototype.createDataChannel = function (...a) { const c = make.apply(this, a); window.__dcs.push(c); return c; };
})();
"""


def connect(host, guest):
    hp, gp = host.page, guest.page
    hp.click("#menu-team")
    hp.click(".menu-list button:has-text('Start a live session')")
    hp.wait_for_selector("#live-offer-code", timeout=20000)
    offer = hp.input_value("#live-offer-code")
    gp.click("#menu-team")
    gp.click(".menu-list button:has-text('Join a live session')")
    gp.fill("#live-join-code", offer)
    gp.click("#live-join-go")
    gp.wait_for_selector("#live-answer-code", timeout=20000)
    hp.fill("#live-answer-in", gp.input_value("#live-answer-code"))
    hp.click("#live-connect")
    hp.wait_for_selector("#live-people li.peer .fp", timeout=20000)
    gp.keyboard.press("Escape")


def hostile_messages(pdf):
    """What a hostile host could send down the data channel."""
    big = "x" * 1_600_000
    evil = "<img src=x onerror=window.__pwned=1>"
    mk = lambda **kw: dict({"id": "h1", "type": "count", "page": 1, "points": [[400, 400]], "subject": evil, "vers": ["z1"]}, **kw)  # noqa: E731
    out = ["not json", "{", "[]", "null", "1", '"str"', json.dumps({"t": big}), "[" * 100000 + "]" * 100000,
           json.dumps({"t": "__proto__", "x": 1}), json.dumps({"t": "constructor"}), json.dumps({"t": "toString"}), json.dumps({"__proto__": {"polluted": 1}, "t": "cursor", "page": 0, "x": 1, "y": 1}),
           json.dumps({"t": "hello", "v": 1, "name": evil, "pdf": pdf, "peer": "h-evil"}), json.dumps({"t": "hello", "v": 1, "name": "again", "pdf": pdf, "peer": "h-evil"}),
           json.dumps({"t": "roster", "peers": [{"peer": "p" + str(i), "name": evil} for i in range(9)]}),
           json.dumps({"t": "roster", "peers": [{"peer": "__proto__", "name": "x"}, {"peer": "constructor", "name": "y"}], "locked": True}),
           json.dumps({"t": "lock", "locked": False}),
           json.dumps({"t": "signal", "to": "nobody", "from": "h-evil", "kind": "offer", "sdp": "v=0\r\nnot an sdp"}),
           json.dumps({"t": "put", "markup": mk()}), json.dumps({"t": "put", "markup": mk(page=999)}), json.dumps({"t": "put", "markup": mk(id="__proto__")}),
           json.dumps({"t": "put", "markup": mk(id="h2", type="text", text=evil * 10, color="red;background:url(x)", custom={"__proto__": "x", "a": evil})}),
           json.dumps({"t": "comment", "id": "h1", "comment": {"id": "c1", "text": evil, "author": evil}}),
           json.dumps({"t": "state", "markups": [mk(id="s" + str(i)) for i in range(300)]}),
           json.dumps({"t": "draft", "page": 1, "type": "polyline", "points": [[i, i] for i in range(2000)]}),
           json.dumps({"t": "draft", "page": 1, "type": "script", "points": []}),
           json.dumps({"t": "del", "id": "h2"}), json.dumps({"t": "settings", "net": {"ocr": True}}), json.dumps({"t": "bye-not"})]
    out += [json.dumps({"t": "cursor", "page": 1, "x": i, "y": i}) for i in range(400)]
    out += ["junk %d" % i for i in range(60)]
    return out


def test_live_session_survives_a_hostile_peer(browser, server):
    """Every message type, malformed and oversized messages, prototype keys, HTML in every text field and
    floods from the host (the most trusted peer): the guest shows text as text, keeps running, never
    changes its settings and drops the peer once it has sent too much that was refused."""
    host, guest = App(browser, server), App(browser, server)
    try:
        host.page.add_init_script(CAPTURE_CHANNELS)
        host.page.evaluate(CAPTURE_CHANNELS)
        for a, n in ((host, "Ana"), (guest, "Ben")):
            set_name_and_switches(a, n, live=True)
            a.floor_plan()
        connect(host, guest)
        hp, gp = host.page, guest.page
        gp.click("#live-chip")
        gp.wait_for_selector("#live-people li.peer .fp", timeout=20000)
        pdf = gp.evaluate("() => new Promise((r) => { const b = Uint8Array.from(atob(document.getElementById('example-pdf').textContent.replace(/\\s+/g, '')), (c) => c.charCodeAt(0)); crypto.subtle.digest('SHA-256', b).then((d) => r(Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join(''))); })")
        msgs = hostile_messages(pdf)
        hp.evaluate("""(msgs) => { const dc = window.__dcs.find((c) => c.readyState === 'open');
            for (const m of msgs) { try { dc.send(m); } catch (e) {} } }""", msgs)
        gp.wait_for_timeout(2500)
        assert guest.errors == [], guest.errors
        assert gp.evaluate("() => window.__pwned") is None
        assert gp.evaluate("() => ({}).polluted") is None
        assert gp.evaluate("() => document.querySelectorAll('img[src=\"x\"], [onerror], [onload]').length") == 0
        ms = guest.markups()
        assert len(ms) <= 400 and all(m["page"] < 3 for m in ms)
        assert all(m["id"] not in ("__proto__", "constructor") for m in ms)
        texts = [m.get("subject", "") for m in ms if m.get("subject")]
        assert evil_text_kept_as_text(texts)
        # the guest still works and its network switches are as it set them
        gp.click("#menu-file")
        gp.click(".menu-list button:has-text('Settings')")
        assert gp.is_checked("#set-net-live") and not gp.is_checked("#set-net-ocr")
        gp.keyboard.press("Escape")
        assert gp.evaluate("() => takeoffInspect.markupCount()") == len(ms)
        # too many refused messages: the guest dropped the host and said why
        t = time.time()
        while time.time() - t < 10 and "was disconnected" not in guest.msg() and "host ended" not in guest.msg():
            gp.wait_for_timeout(200)
        assert "disconnected" in guest.msg() or "host ended" in guest.msg(), guest.msg()
        assert gp.locator("#live-people li.peer").count() == 0
        assert host.errors == []
    finally:
        host.close()
        guest.close()


def evil_text_kept_as_text(texts):
    return all("<img" not in t or "onerror" in t for t in texts)


CAPTURE_INCOMING = """
(() => {
  window.__dcs = window.__dcs || [];
  const d = Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, "ondatachannel");
  Object.defineProperty(RTCPeerConnection.prototype, "ondatachannel", { configurable: true, get() { return d.get.call(this); },
    set(fn) { d.set.call(this, (e) => { window.__dcs.push(e.channel); fn(e); }); } });
})();
"""


def _wait(page, cond, secs=10):
    t = time.time()
    while time.time() - t < secs and not cond():
        page.wait_for_timeout(150)
    return cond()


def test_live_guests_can_edit_only_their_own_markups(browser, server):
    host, guest = live_app(browser, server, "Ana"), live_app(browser, server, "Ben")
    try:
        hp, gp = host.page, guest.page
        gp.add_init_script(CAPTURE_INCOMING)
        gp.evaluate(CAPTURE_INCOMING)
        connect(host, guest)
        a = draw_count(host, [(4, 4)])
        assert _wait(gp, lambda: a["id"] in [m["id"] for m in guest.markups()])
        hp.click("#live-chip") if hp.locator("#live-panel").count() == 0 else None
        hp.wait_for_selector("#live-own")
        hp.check("#live-own")
        gp.click("#live-chip")
        assert _wait(gp, lambda: "change only your own markups" in gp.inner_text("#live-panel"))
        gp.keyboard.press("Escape")
        # the guest deletes the host's markup: it goes on the guest's device only, and the guest is told
        guest.click_pt(plan_pt(4, 4))
        gp.keyboard.press("Delete")
        assert _wait(gp, lambda: "Only your own markups are shared" in gp.inner_text("#sb-message"))
        hp.wait_for_timeout(800)
        assert a["id"] in [m["id"] for m in host.markups()]
        # the guest's own markup is shared, and the guest may delete it
        b = draw_count(guest, [(6, 6)])
        assert b["author"] == "Ben"
        assert _wait(hp, lambda: b["id"] in [m["id"] for m in host.markups()])
        # a guest app that ignores the setting is refused on receive: it cannot take over, edit or delete
        taken = dict(a, author="Ben", label="mine now", vers=a.get("vers", []) + ["zz"])
        gp.evaluate("""(msgs) => { const dc = window.__dcs.find((c) => c.readyState === 'open'); for (const m of msgs) dc.send(m); }""",
                    [json.dumps({"t": "put", "markup": taken}), json.dumps({"t": "del", "id": a["id"]})])
        assert _wait(hp, lambda: "not theirs" in hp.inner_text("#sb-message"))
        ha = [m for m in host.markups() if m["id"] == a["id"]]
        assert ha and ha[0].get("label", "") != "mine now" and ha[0].get("author") == "Ana"
        assert host.errors == [] and guest.errors == []
    finally:
        host.close()
        guest.close()
