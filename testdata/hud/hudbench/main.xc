; hudbench — the PLAYER HUD law fixture (tools/make_hud_test.py).
; The speed readout class, small: the avatar_sensor_speed the Homo Hud and
; the subscribed speed item both display, through a declared @function.
include "parse.xc"

var $panel = panel(bottom, 240, 90)

init
	$panel.blank(color(16,20,32,220))
	$panel.write(4,4,white,"hudbench")

tick
	var $kmh = @speed_kph(get("avatar_sensor_speed"))
	var $alt = round(get("avatar_sensor_altitude"))
	$panel.blank(color(16,20,32,220))
	$panel.write(4,4,white,"hudbench")
	$panel.write(4,24,cyan,text("{0} km/h", $kmh))
	$panel.write(4,48,green,text("alt {0} m", $alt))
