-- "Send to Comics Cuz Yes" — drop a drawing on this app's icon.
-- Build with: ./clients/build-droplet.sh
--
-- The secret below only means "allowed to submit a comic". It is not a GitHub
-- token and cannot publish anything on its own; everything still waits for
-- approval. If it ever leaks, rotate SUBMIT_SECRET on the Worker and rebuild.

property endpoint : "https://publish.comicscuzyes.com/submit"
property submitSecret : "PASTE_SUBMIT_SECRET_HERE"
property okKinds : {"png", "jpg", "jpeg", "gif", "webp"}

on run
	display dialog "Drag a comic onto this app to send it to Dad." & return & return & ¬
		"You can keep it in the Dock and drop pictures on it any time." ¬
		buttons {"OK"} default button "OK" with title "Comics Cuz Yes" with icon note
end run

on open theFiles
	repeat with aFile in theFiles
		sendOne(aFile)
	end repeat
end open

on sendOne(aFile)
	set filePath to POSIX path of aFile
	set fileName to name of (info for aFile)

	-- extension check, so a stray .psd doesn't travel all the way to the server
	set ext to my lowercased(my extensionOf(fileName))
	if okKinds does not contain ext then
		display dialog "\"" & fileName & "\" is a ." & ext & " file." & return & return & ¬
			"Save it as a PNG or JPG first, then drop it on again." ¬
			buttons {"OK"} default button "OK" with title "Wrong kind of file" with icon caution
		return
	end if

	-- title, pre-filled from the filename so she can just hit Send
	set suggested to my prettify(my baseNameOf(fileName))
	set r to display dialog "What's this comic called?" default answer suggested ¬
		buttons {"Cancel", "Next"} default button "Next" with title "Comics Cuz Yes"
	set comicTitle to text returned of r
	if comicTitle is "" then set comicTitle to suggested

	set r2 to display dialog "Say something about it, if you want." & return & ¬
		"(You can leave this empty.)" default answer "" ¬
		buttons {"Cancel", "Send it"} default button "Send it" with title "Comics Cuz Yes"
	set comicNote to text returned of r2

	-- -F handles the multipart encoding; quoted form handles the shell quoting.
	set cmd to "curl -sS --max-time 120 -w '\\n%{http_code}' -X POST " & ¬
		"-H " & quoted form of ("Authorization: Bearer " & submitSecret) & " " & ¬
		"-F " & quoted form of ("image=@" & filePath) & " " & ¬
		"-F " & quoted form of ("title=" & comicTitle) & " " & ¬
		"-F " & quoted form of ("note=" & comicNote) & " " & ¬
		quoted form of endpoint

	try
		set reply to do shell script cmd
	on error errMsg
		display dialog "Couldn't reach the site." & return & return & errMsg & return & return & ¬
			"Check the wifi and try dropping it on again." ¬
			buttons {"OK"} default button "OK" with title "Didn't send" with icon stop
		return
	end try

	set statusCode to my lastLine(reply)
	if statusCode is "200" then
		display dialog "Sent! \"" & comicTitle & "\" is waiting for Dad to say yes." ¬
			buttons {"Yay"} default button "Yay" with title "Comics Cuz Yes" with icon note
	else
		display dialog "The site said no (" & statusCode & ")." & return & return & ¬
			my allButLastLine(reply) buttons {"OK"} default button "OK" ¬
			with title "Didn't send" with icon stop
	end if
end sendOne

-- helpers ------------------------------------------------------------------

on extensionOf(f)
	set AppleScript's text item delimiters to "."
	set parts to text items of f
	set AppleScript's text item delimiters to ""
	if (count of parts) < 2 then return ""
	return item -1 of parts
end extensionOf

on baseNameOf(f)
	set AppleScript's text item delimiters to "."
	set parts to text items of f
	set AppleScript's text item delimiters to ""
	if (count of parts) < 2 then return f
	set AppleScript's text item delimiters to "."
	set b to (items 1 thru -2 of parts) as text
	set AppleScript's text item delimiters to ""
	return b
end baseNameOf

on prettify(s)
	set AppleScript's text item delimiters to {"-", "_"}
	set parts to text items of s
	set AppleScript's text item delimiters to " "
	set out to parts as text
	set AppleScript's text item delimiters to ""
	return out
end prettify

on lowercased(s)
	return do shell script "printf %s " & quoted form of s & " | tr '[:upper:]' '[:lower:]'"
end lowercased

on lastLine(s)
	set AppleScript's text item delimiters to return & linefeed
	set s to s
	set AppleScript's text item delimiters to linefeed
	set L to text items of s
	set AppleScript's text item delimiters to ""
	return item -1 of L
end lastLine

on allButLastLine(s)
	set AppleScript's text item delimiters to linefeed
	set L to text items of s
	if (count of L) < 2 then
		set AppleScript's text item delimiters to ""
		return ""
	end if
	set out to (items 1 thru -2 of L) as text
	set AppleScript's text item delimiters to ""
	return out
end allButLastLine
