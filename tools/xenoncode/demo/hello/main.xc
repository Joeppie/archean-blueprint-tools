; hello.xc - XenonCode POC program (authored by us for tools/xenoncode; GPL-3.0).
; It proves the simulated-computer contract the host exposes:
;   * print()            -> the host console / event log
;   * input_number(1, 7) -> a channel read PURELY as a NUMERIC input whose
;     value is provided EXTERNALLY by the simulated computer panel (a dial on
;     the page, XC_DIAL on the CLI)
;   * screen()           -> text + pixel drawing through the dev's screen model
;   * storage var        -> survives the simulated computer's reboot
;   * output_number      -> the simulated io bus
storage var $boots : number
var $scr = screen("Main", 0)

init
	$boots += 1
	print("Hello from XenonCode!")
	print(text("Boot number: {}", $boots))

tick
	var $dial = input_number(1, 7)
	$scr.blank()
	$scr.text_size(3)
	$scr.write(24, 16, white, "Hello, XenonCode!")
	$scr.text_size(2)
	$scr.write(24, 70, yellow, text("Dial (io 1, channel 7): {0.00}", $dial))
	$scr.write(24, 100, cyan, text("boots (storage): {}", $boots))
	; the dial draws a bar one PIXEL at a time; colour follows the sign
	var $lit = floor(($dial + 1) * 50)
	repeat 100 ($i)
		if $i < $lit
			var $c = if($dial < 0, red, if($dial > 0, lime, gray))
			$scr.pixel(24 + $i, 140, $c)
	; echo the dial back onto the simulated io bus (doubled)
	output_number(1, 0, $dial * 2)
