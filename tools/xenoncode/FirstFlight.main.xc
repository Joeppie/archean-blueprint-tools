; This code was generated from Nodes. To go back to the original Nodes, you may erase this comment line and remove the ';' in front of the #NODES line below. CAUTION: Your changes in the code will be overwritten once you make a change in the nodes.
;#NODES {"nodes":[{"channel":1,"id":"NODE7D5420DF5FEC0DF1C21DDE45","inputs":[],"ioNumber":11,"outputType":0,"pos":{"x":109.0422134399414,"y":48.198055267333984},"size":{"x":257.0389709472656,"y":66.2337646484375},"title":"input.11","type":"InputNode"},{"id":"NODE7D5420DFEC95E8FDC21D0A9A","inputTypes":[0],"inputValues":[""],"inputs":["NODE7D5420DFF146091AC31D0E5F"],"ioNumber":8,"outputType":2,"pos":{"x":773.1655883789063,"y":30.990276336669922},"size":{"x":147.12982177734375,"y":86.36363983154297},"title":"output.8","type":"OutputNode"},{"channel":2,"id":"NODE7D5420DF4A1DC7FEC21D6658","inputs":[],"ioNumber":11,"outputType":0,"pos":{"x":127.38636016845703,"y":180.5032501220703},"size":{"x":211.5844268798828,"y":66.2337646484375},"title":"input.11","type":"InputNode"},{"id":"NODE7D5420DFA96B5BFFC21D1284","inputTypes":[0],"inputValues":[""],"inputs":["NODE7D5420DF4A1DC7FEC21D6658"],"ioNumber":7,"outputType":2,"pos":{"x":523.003173828125,"y":164.4318084716797},"size":{"x":147.12982177734375,"y":86.36363983154297},"title":"output.7","type":"OutputNode"},{"channel":5,"id":"NODE7D5420DF7EE35901C31D4A24","inputs":[],"ioNumber":11,"outputType":0,"pos":{"x":72.02920532226563,"y":349.4967956542969},"size":{"x":166.77923583984375,"y":66.2337646484375},"title":"input.11","type":"InputNode"},{"id":"NODE7D5420DF630EA20DC31D5EAC","inputTypes":[0],"inputValues":[""],"inputs":["NODE7D5420DF99201416C31D1633"],"ioNumber":9,"outputType":2,"pos":{"x":435.1786193847656,"y":446.412353515625},"size":{"x":147.12989807128906,"y":86.36363983154297},"title":"output.9","type":"OutputNode"},{"id":"NODE7D5420DFBD370E11C31D321D","inputTypes":[0],"inputValues":[""],"inputs":["NODE7D5420DF7EE35901C31D4A24"],"ioNumber":10,"outputType":2,"pos":{"x":347.5162048339844,"y":334.56170654296875},"size":{"x":147.12989807128906,"y":86.36363983154297},"title":"output.10","type":"OutputNode"},{"id":"NODE7D5420DF99201416C31D1633","inputTypes":[0],"inputValues":[""],"inputs":["NODE7D5420DF7EE35901C31D4A24"],"outputType":0,"pos":{"x":306.6071472167969,"y":434.56170654296875},"size":{"x":67.532470703125,"y":45.0},"title":"NEGATIVE","type":"MathNode_NEGATIVE"},{"id":"NODE7D5420DFF146091AC31D0E5F","inputTypes":[0],"inputValues":[""],"inputs":["NODE7D5420DF5AC01C5CC31D1A74"],"outputType":0,"pos":{"x":628.5226440429688,"y":31.314945220947266},"size":{"x":67.532470703125,"y":45.0},"title":"NEGATIVE","type":"MathNode_NEGATIVE"},{"channel":3,"id":"NODE7D5420DF005E7D20C31D2A71","inputs":[],"ioNumber":11,"outputType":0,"pos":{"x":29.821434020996094,"y":576.282470703125},"size":{"x":301.84417724609375,"y":66.2337646484375},"title":"input.11","type":"InputNode"},{"id":"NODE7D5420DFB64F9E21C31D7ED3","inputTypes":[0,0],"inputValues":["",""],"inputs":["NODE7D5420DF005E7D20C31D2A71","NODE7D5420DF9E0D9822C31DDE77"],"ioNumber":5,"outputType":2,"pos":{"x":613.4253540039063,"y":603.7175903320313},"size":{"x":135.0,"y":106.4935073852539},"title":"output.5","type":"OutputNode"},{"channel":4,"id":"NODE7D5420DF9E0D9822C31DDE77","inputs":[],"ioNumber":11,"outputType":0,"pos":{"x":209.6915740966797,"y":693.0032348632813},"size":{"x":204.4415740966797,"y":66.2337646484375},"title":"input.11","type":"InputNode"},{"id":"NODE7D5420DF5AC01C5CC31D1A74","inputTypes":[0,0],"inputValues":["","-0.1"],"inputs":["NODE7D5420DF5FEC0DF1C21DDE45",""],"outputType":0,"pos":{"x":452.3863525390625,"y":82.84090423583984},"size":{"x":35.0,"y":65.0},"title":"ADD","type":"MathNode_ADD"}]}

var $Numset: number
storage var $rollnum: number
storage var $pitchnum :number
var $Prop_Pitch: number
storage var $propnum: number

include "functions.xc"

var $rightDash = screen("TrimsDash",0)

update
	var $Pilot_WS = input_number(11, 1)
	var $Pilot_AD = input_number(11, 2)
	$Prop_Pitch = $propnum
	var $Pilot_QE = input_number(11, 5)
	output_number("PitchControlJunction", 0, (-($Pilot_WS + $pitchnum)))
	var $_input_number_11_2 = input_number(11, 2)
	output_number(7, 0, $_input_number_11_2)
	
	;Wheel steering
	output_number("DragWheelSteering",1,$Pilot_QE * -0.75)
	;var $_input_number_11_5 = input_number(11, 5)
	output_number("LeftWingJunction", 0, -$Pilot_AD*0.5)
	output_number("RightWingJunction", 0, $Pilot_AD*0.5)
	;var $_input_number_11_3 = input_number(11, 3)
	output_number("Engine", 0, $Numset/50)
	output_number("Engine",1,$Prop_Pitch)
	var $_input_number_11_4 = input_number(11, 4)
	output_number(5, 1, $_input_number_11_4)
	output_number("Rudder",0,$Pilot_QE+$rollnum)
	;print($Prop_Pitch)
	if input_number(11,17)== 1
		$Numset = 0
	if input_number(11,12) == 1
		$propnum = 0
	$rightDash.text_size(2)
	$rightDash.blank()
	
	$rightDash.write(20,20,white,text("Throttle:{}",$Numset))
	$rightDash.write(20,20+$rightDash.char_h*1.5,white,text("Prop Pitch:{0.00}",$propnum))
	$rightDash.write(20,20+$rightDash.char_h*3,white,text("Elevator Trim:{0.00}",$pitchnum))
	$rightDash.write(20,20+$rightDash.char_h*4.5,white,text("Roll Trim:{0.00}",$rollnum))
