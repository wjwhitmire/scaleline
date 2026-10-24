"""Merging markup files: version histories, conflicts and their choices, tombstones, comments and
status history, and document parts."""

import pytest

from plantakeoff import markups as mk
from plantakeoff.brand import FILE_FORMAT
from plantakeoff.merge import merge_documents, merge_markups


def m(i, pts, vers, **kw):
    return dict({"id": i, "type": "count", "page": 0, "points": pts, "vers": vers}, **kw)


def tomb(i, vers):
    return {"id": i, "at": "2026-10-22T00:00:00Z", "by": "Ana", "vers": vers}


BASE = m("a", [[1, 1]], ["v1"])


def test_newer_side_wins_without_a_conflict():
    mine = m("a", [[2, 2]], ["v1", "v2"])
    r = merge_markups([mine], [BASE])
    assert r["markups"] == [mine] and r["report"]["kept"] == 1 and not r["conflicts"]
    r = merge_markups([BASE], [mine])
    assert r["markups"][0]["points"] == [[2, 2]] and r["report"]["updated"] == 1


def test_concurrent_edits_are_a_conflict_until_chosen():
    mine, theirs = m("a", [[2, 2]], ["v1", "v2"]), m("a", [[3, 3]], ["v1", "v3"])
    r = merge_markups([mine], [theirs])
    assert [c["kind"] for c in r["conflicts"]] == ["edited"] and r["markups"][0]["points"] == [[2, 2]]
    assert merge_markups([mine], [theirs], choices={"a": "mine"})["markups"][0]["points"] == [[2, 2]]
    t = merge_markups([mine], [theirs], choices={"a": "theirs"})["markups"]
    assert t[0]["points"] == [[3, 3]] and t[0]["vers"] == ["v2", "v1", "v3"]
    both = merge_markups([mine], [theirs], choices={"a": "both"})
    assert [x["id"] for x in both["markups"]] == ["a", "a.2"] and both["report"]["resolved"] == 1


def test_a_settled_conflict_is_not_asked_again_by_the_same_file():
    mine, theirs = m("a", [[2, 2]], ["v1", "v2"]), m("a", [[3, 3]], ["v1", "v3"])
    for choice in ("mine", "theirs", "both"):
        first = merge_markups([mine], [theirs], choices={"a": choice})
        again = merge_markups(first["markups"], [theirs], first["tombstones"])
        assert not again["conflicts"], choice
        assert [x["points"] for x in again["markups"]] == [x["points"] for x in first["markups"]], choice
    both = merge_markups([mine], [theirs], choices={"a": "both"})["markups"]
    assert both[0]["points"] == [[2, 2]] and both[0]["vers"][-1] == "v2" and "v3" in both[0]["vers"]
    # I deleted it and keep it deleted although they edited it
    gone = merge_markups([], [m("a", [[2, 2]], ["v1", "v2"])], [tomb("a", ["v1"])], choices={"a": "mine"})
    assert gone["markups"] == [] and gone["tombstones"][0]["vers"] == ["v1", "v2"]
    again = merge_markups([], [m("a", [[2, 2]], ["v1", "v2"])], gone["tombstones"])
    assert again["markups"] == [] and not again["conflicts"]


def test_same_drawing_with_different_histories_is_not_a_conflict():
    r = merge_markups([m("a", [[2, 2]], ["v1", "v2"])], [m("a", [[2, 2.0]], ["v1", "v9"])])
    assert not r["conflicts"] and r["report"]["kept"] == 1


def test_deletions_travel_and_edits_after_a_deletion_ask():
    # they deleted the version I have: it goes
    r = merge_markups([BASE], [], [], [tomb("a", ["v1"])])
    assert r["markups"] == [] and r["report"]["removed"] == 1 and r["tombstones"][0]["id"] == "a"
    # I deleted it, they kept editing: ask
    r = merge_markups([], [m("a", [[2, 2]], ["v1", "v2"])], [tomb("a", ["v1"])])
    assert r["conflicts"][0]["kind"] == "deleted_by_me" and r["markups"] == []
    keep = merge_markups([], [m("a", [[2, 2]], ["v1", "v2"])], [tomb("a", ["v1"])], choices={"a": "theirs"})
    assert keep["markups"][0]["points"] == [[2, 2]] and keep["tombstones"] == []
    # their stale copy of something I deleted stays deleted
    r = merge_markups([], [BASE], [tomb("a", ["v1"])])
    assert r["markups"] == [] and not r["conflicts"]
    # a deletion neither side has seen is carried along
    r = merge_markups([BASE], [BASE], [], [tomb("zz", [])])
    assert [t["id"] for t in r["tombstones"]] == ["zz"]


def test_comments_and_status_history_merge_on_whichever_version_wins():
    mine = m("a", [[2, 2]], ["v1", "v2"], comments=[{"id": "c1", "author": "Ana", "at": "1", "text": "Check @Ben"}])
    theirs = m("a", [[1, 1]], ["v1"], comments=[{"id": "c2", "author": "Ben", "at": "2", "text": "On it", "reply_to": "c1"},
                                               {"id": "c1", "author": "Ana", "at": "1", "text": "", "deleted": True}],
               status_log=[{"status": "Review", "by": "Ben", "at": "2026-10-02"}])
    out = merge_markups([mine], [theirs])["markups"][0]
    assert out["points"] == [[2, 2]]
    assert [(c["id"], c.get("deleted", False)) for c in out["comments"]] == [("c1", True), ("c2", False)]
    assert out["status_log"] == [{"status": "Review", "by": "Ben", "at": "2026-10-02"}]


def doc(markups, **kw):
    d = {"format": FILE_FORMAT, "version": 1, "markups": markups}
    d.update(kw)
    return mk.clean_document(d)[0]


def test_documents_union_their_layers_pages_and_markups():
    mine = doc([BASE], layers=[{"id": "walls", "name": "Walls"}], pages={"0": {"label": "A-101"}})
    theirs = doc([m("b", [[5, 5]], ["w1"])], layers=[{"id": "walls", "name": "Theirs"}, {"id": "site", "name": "Site"}],
                 pages={"0": {"label": "X", "scale": {"in_per_pt": 1}}, "4": {"label": "C-1"}})
    r = merge_documents(mine, theirs)
    d = r["doc"]
    assert [x["id"] for x in d["markups"]] == ["a", "b"] and r["report"]["added"] == 1
    assert [(x["id"], x["name"]) for x in d["layers"]] == [("walls", "Walls"), ("site", "Site")]
    assert d["pages"]["0"]["label"] == "A-101" and d["pages"]["0"]["scale"]["in_per_pt"] == 1 and d["pages"]["4"]["label"] == "C-1"


def test_session_fields_survive_cleaning():
    d = doc([dict(BASE, rev=4, vers=["v1", "v2", "v2", "bad id"], status="Accepted", assignee="Ben", modified_by="Ana",
                  status_log=[{"status": "Accepted", "by": "Ben", "at": "2026-10-02T11:00:00Z"}, "x"],
                  comments=[{"id": "c1", "author": "Ana", "at": "t", "text": "Looks right"}, {"id": "c1", "text": "dup"},
                            {"id": "c2", "text": "", "deleted": True}, {"id": "c3", "text": ""}])],
            tombstones=[tomb("old", ["q"]), tomb("a", ["v1"])])
    x = d["markups"][0]
    assert x["rev"] == 4 and x["vers"] == ["v1", "v2"] and x["assignee"] == "Ben" and x["modified_by"] == "Ana"
    assert [c["id"] for c in x["comments"]] == ["c1", "c2"] and x["comments"][1]["deleted"] is True
    assert len(x["status_log"]) == 1
    # a tombstone for a markup that is present is dropped
    assert [t["id"] for t in d["tombstones"]] == ["old"]


@pytest.mark.parametrize("bad", [{"id": "x", "text": "a" * 3000}])
def test_comment_text_is_capped(bad):
    c = mk.clean_comment(bad)
    assert len(c["text"]) == 2000


def test_cli_merge(tmp_path, capsys):
    import json
    from plantakeoff.cli import main
    a = {"format": FILE_FORMAT, "version": 1, "markups": [m("a", [[2, 2]], ["v1", "v2"]), m("b", [[1, 1]], ["b1"])]}
    b = {"format": FILE_FORMAT, "version": 1, "markups": [m("a", [[3, 3]], ["v1", "v3"]), m("c", [[4, 4]], ["c1"])]}
    (tmp_path / "a.json").write_text(json.dumps(a))
    (tmp_path / "b.json").write_text(json.dumps(b))
    assert main(["merge", str(tmp_path / "a.json"), str(tmp_path / "b.json"), "--conflicts", "both"]) == 0
    out = capsys.readouterr()
    doc = json.loads(out.out)
    assert [x["id"] for x in doc["markups"]] == ["a", "a.2", "b", "c"]
    assert "conflict: a (edited)" in out.err
    assert main(["library"]) == 0
    assert len(json.loads(capsys.readouterr().out)["assemblies"]) >= 150


def test_keep_mine_against_their_deletion_settles_on_the_first_merge():
    mine = [m("a", [[1, 1]], ["v1", "v2"])]
    theirs_tombs = [tomb("a", ["v1"])]
    first = merge_markups(mine, [], [], theirs_tombs)
    assert [c["kind"] for c in first["conflicts"]] == ["deleted_by_them"]
    kept = merge_markups(mine, [], [], theirs_tombs, {"a": "mine"})
    assert kept["conflicts"] == [] and kept["markups"][0]["vers"] == ["v1", "kept:v1", "v2"]
    # the same teammate file again: no question, mine stays
    again = merge_markups(kept["markups"], [], [], theirs_tombs)
    assert again["conflicts"] == [] and [x["id"] for x in again["markups"]] == ["a"] and again["report"]["kept"] == 1
    # the mark survives a round trip through the file
    d, _ = mk.clean_document({"format": FILE_FORMAT, "version": 1, "markups": kept["markups"]})
    assert d["markups"][0]["vers"] == ["v1", "kept:v1", "v2"]
    # a later deletion of a newer version is a new question
    assert merge_markups(kept["markups"], [], [], [tomb("a", ["v1", "v9"])])["conflicts"]


def test_a_merge_past_the_markup_limit_stops_before_merging():
    from plantakeoff.errors import TakeoffError
    mine = [m(f"a{i}", [[1, 1]], ["v"]) for i in range(60000)]
    theirs = [m(f"b{i}", [[1, 1]], ["v"]) for i in range(50000)]
    with pytest.raises(TakeoffError) as e:
        merge_markups(mine, theirs)
    assert e.value.code == "limit" and "110,000 markups; the limit is 100,000. Nothing was merged" in e.value.message
    assert len(merge_markups(mine, theirs[:40000])["markups"]) == 100000
