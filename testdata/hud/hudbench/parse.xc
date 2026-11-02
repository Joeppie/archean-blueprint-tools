; the include the Library-tab leg indexes: @speed_kph is THIS hud's own
; declared function (click in the Library = jump to this line).
function @speed_kph($v : number) : number
	return $v * 3.6

function @clamped($v : number, $hi : number) : number
	if $v > $hi
		return $hi
	return $v
