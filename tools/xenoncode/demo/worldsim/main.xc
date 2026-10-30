; worldsim API fixture: setworldsim overrides a named channel, getworldsim
; answers its effective value; 9e99 releases the override.
init
	setworldsim("nav.altitude", 2000)
	print(text("ws get: {}", getworldsim("nav.altitude")))
	setworldsim("nav.altitude", pow(10,40))
	print(text("released: {}", getworldsim("nav.altitude")))

update
	print(text("cycle: {}", getworldsim("nav.altitude")))
