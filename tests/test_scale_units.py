"""Units, standard scales, calibration round trips and scale notes."""

import pytest

from plantakeoff import scale as s
from plantakeoff import units as u
from plantakeoff.errors import TakeoffError


@pytest.mark.parametrize("text,inches", [
    ("12'-6\"", 150), ("12' 6\"", 150), ("12'6\"", 150), ("12' 6 1/2\"", 150.5), ("12'-6-1/2\"", 150.5),
    ("12'6-1/2\"", 150.5), ("6\"", 6), ("1/4\"", 0.25), ("1 1/2\"", 1.5), ("12'", 144), ("12 ft", 144),
    ("12.5 ft", 150), ("0'-3/8\"", 0.375), ("12′-6″", 150), ("7", 84), ("7 1/2", 90),
])
def test_parse_feet_inches(text, inches):
    assert u.parse_length(text) == pytest.approx(inches, rel=1e-12)


def test_parse_metric_and_defaults():
    assert u.parse_length("3.2 m") == pytest.approx(3200 / 25.4)
    assert u.parse_length("250 mm") == pytest.approx(250 / 25.4)
    assert u.parse_length("25 cm") == pytest.approx(250 / 25.4)
    assert u.parse_length("2 yd") == 72
    assert u.parse_length("10", "m") == pytest.approx(10000 / 25.4)
    assert u.parse_length("10", "in") == 10


@pytest.mark.parametrize("bad", ["", "abc", "12'-x\"", "1/0\"", "5 parsecs", "1" * 70])
def test_parse_rejects(bad):
    with pytest.raises(TakeoffError):
        u.parse_length(bad)


@pytest.mark.parametrize("inches,text", [
    (150.5, "12'-6 1/2\""), (144, "12'-0\""), (11.99999, "1'-0\""), (0.0625, "0'-0 1/16\""),
    (0.5, "0'-0 1/2\""), (-18, "-1'-6\""), (0.01, "0'-0\""), (35.96875, "3'-0\""),
])
def test_format_ftin(inches, text):
    assert u.format_ftin(inches) == text


def test_format_ftin_denominators():
    assert u.format_ftin(150.3, 8) == "12'-6 1/4\""
    assert u.format_ftin(150.3, 1) == "12'-6\""
    with pytest.raises(TakeoffError):
        u.format_ftin(1, 3)


def test_conversions_exact_factors():
    assert u.from_inches(12, "ft") == 1
    assert u.from_inches(39.37007874015748, "m") == pytest.approx(1)
    assert u.area_from_sq_in(144, "sf") == 1
    assert u.area_from_sq_in(1296, "sy") == 1
    assert u.volume_from_cu_in(46656, "cy") == 1
    assert u.convert(1, "cy", "cf") == 27
    assert u.convert(1, "sm", "sf") == pytest.approx(10.763910416709722)
    assert u.convert(1, "acre", "sf") == 43560
    assert u.convert(1, "ftin", "in") == 12
    with pytest.raises(TakeoffError):
        u.convert(1, "sf", "ft")


def test_format_number():
    assert u.format_number(1234567.891, 2) == "1,234,567.89"
    assert u.format_number(0.005, 2) == "0.01"
    assert u.format_number(-0.004, 2) == "0.00"
    assert u.format_number(2.5, 0) == "3"
    assert u.format_number(float("nan"), 2) == "-"


def test_standard_scales():
    quarter = next(x for x in s.STANDARD_SCALES if x["label"] == '1/4" = 1\'-0"')
    assert quarter["in_per_pt"] == pytest.approx(12 / 18)
    assert s.ratio_of(quarter["in_per_pt"]) == pytest.approx(48)
    eng = next(x for x in s.STANDARD_SCALES if x["label"] == '1" = 20\'')
    assert s.ratio_of(eng["in_per_pt"]) == pytest.approx(240)
    met = next(x for x in s.STANDARD_SCALES if x["label"] == "1:100")
    assert s.ratio_of(met["in_per_pt"]) == pytest.approx(100)
    assert len({x["label"] for x in s.STANDARD_SCALES}) == len(s.STANDARD_SCALES)


def test_calibration_round_trip():
    # Two points 180 pt apart (2.5 in of paper) said to be 10'-0": that is 1/4" = 1'-0".
    ipp = s.calibrate([100, 100], [280, 100], 120)
    assert s.nearest_standard(ipp)["label"] == '1/4" = 1\'-0"'
    assert s.ratio_of(ipp) == pytest.approx(48)
    # Measuring the same two points gives back exactly the known distance.
    assert 180 * ipp == pytest.approx(120, rel=1e-15)


def test_calibration_rejects():
    with pytest.raises(TakeoffError):
        s.calibrate([1, 1], [1, 1], 10)
    with pytest.raises(TakeoffError):
        s.calibrate([0, 0], [1, 1], 0)
    with pytest.raises(TakeoffError):
        s.scale_from_ratio(0, 12)


def test_nearest_standard_tolerance():
    q = 12 / 18
    assert s.nearest_standard(q * 1.004)["label"] == '1/4" = 1\'-0"'
    assert s.nearest_standard(q * 1.02) is None


@pytest.mark.parametrize("text,ratio", [
    ('SCALE: 1/4" = 1\'-0"', 48), ("SCALE: 1/8\"=1'", 96), ('1" = 20\'', 240), ('1"=20\'-0"', 240),
    ("SCALE 1:100", 100), ("scale 1 : 50", 50), ('3/16" = 1\'-0"', 64), ('1 1/2" = 1\'-0"', 8), ('3" = 1\'-0"', 4),
    ("1:200", 200),
])
def test_scale_notes(text, ratio):
    found = [f for f in s.parse_scale_text(text) if f["in_per_pt"]]
    assert len(found) == 1
    assert s.ratio_of(found[0]["in_per_pt"]) == pytest.approx(ratio)


def test_scale_notes_ignore_noise_and_find_nts():
    assert s.parse_scale_text("Meeting at 1:30 pm, room 2 = 3") == []
    nts = s.parse_scale_text("DETAIL 4  SCALE: NTS")
    assert nts and nts[0]["in_per_pt"] is None
    assert s.parse_scale_text("NOT TO SCALE")[0]["in_per_pt"] is None
    both = s.parse_scale_text('PLAN 1/4" = 1\'-0"   DETAIL 1 1/2" = 1\'-0"')
    assert [round(s.ratio_of(f["in_per_pt"])) for f in both] == [48, 8]
    assert s.parse_scale_text(None) == []
