
;Incremental function to aid in trim commands. Lower limit and Upper limit sets the bounds of the adjustment.
;increment sets the change that will be added/substracted on each click.
;target should be what the function call is set equal to so the return of the function is set to it.
function @selectcase($inputsource:number,$target: number, $increment: number, $lowerlimit: number,$upperlimit: number):number
	var $result = $target
	;$result = $target
	if $inputsource>0
		// Case is 1 or more
		$result += $increment
	elseif $inputsource < 0
		// Case is less than zero
		$result -= $increment
	else
		//Case is zero
		$result = $result
	//Check limits
	if $result>$upperlimit
		$result = $upperlimit
	elseif $result<$lowerlimit
		$result = $lowerlimit
	else
		$result = $result
	return $result
	

// Starts Throttle by keyboard Example //
timer frequency 4			  
	
	var $change = input_number(11, 3) // uses Ctrl/spacebar to adjust throttle from 0 to 100
	$Numset = @selectcase($change,$Numset,5,0,100)	
	
//Ends Throttle by Keyboard example

//Pitch Trim Start	
	var $pitchtrim_neg = input_number(11,15)  //Aux 8
	var $pitchtrim_pos = input_number(11,9)		//Aux 2
		
	$pitchnum=@selectcase($pitchtrim_neg,$pitchnum,0.005,-0.3,0.3)
	$pitchnum=@selectcase($pitchtrim_pos,$pitchnum,-0.005,-0.3,0.3)
	
//Pitch Trim End

//Roll Trim Start

	var $rolltrim_left = input_number(11,14)   //Aux 7
	var $rolltrim_right = input_number(11,16)  //Aux 9
	
	$rollnum = @selectcase($rolltrim_left,$rollnum,0.005,-0.3,0.3)
	$rollnum = @selectcase($rolltrim_right,$rollnum,-0.005,-0.3,0.3)

//Prop Pitch Start
	var $proppos = input_number(11,10) //Aux 3
	var $propneg = input_number(11,8)  //Aux 1
	
	$propnum = @selectcase($propneg,$propnum,-0.05,-1,1)
	$propnum = @selectcase($proppos,$propnum,0.05,-1,1)
	
// Prop Pitch End
	
	print($pitchnum,$Numset,$rollnum,$Prop_Pitch)
	print("_______________")
		

