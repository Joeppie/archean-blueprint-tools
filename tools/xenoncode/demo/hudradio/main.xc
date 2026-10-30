; XENON-SHUD demo (v1.14.1 P9 slice B): the HUD builtins end to end.
; panel(anchor,w,h) -> a "panel#N" surface (screen members apply),
; beacon($tx,$rx) -> a radio (beaconpair/beacontx events, .data delivery),
; get(key) -> the AVATARSIM world feed (xc_set_world).
;
; run:  XC_BEACON_PUT=1 run/xc_run demo/hudradio 8
;   -> events.json carries the beaconpair (HUD-OUT/HUD-IN) and, after the
;      XC_BEACON_PUT delivery at cycle 3, a beacontx "echo:ping";
;   -> screen-panel#0.ppm shows the drawn panel (blank/write/rects).

var $b = beacon("HUD-OUT", "HUD-IN")
var $p = panel(top, 120, 60)
var $hits = 0

update
	$p.blank(color(10, 10, 30))
	$p.write(2, 2, color(0, 255, 120), "hud demo")
	$p.draw_rect(2, 12, 118, 58, color(0, 120, 255))
	$p.draw_circle(60, 35, 12, color(255, 200, 0))
	var $spd = get("avatar_sensor_speed"):number
	$p.write(6, 40, color(255, 255, 255), text($spd))
	if $b.data != ""
		$hits = $hits + 1
		$b.transmit("echo:" & $b.data)
