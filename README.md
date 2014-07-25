Yui
===
Web-based Music Library / Player

##Introduction:
With the myriads of music players avalible today, one may beg the question why we need yet another one. Well, the answer is a simple, none of the existing solutions avalible were able to satisfly my needs. A bit about myself - I'm a computer engineering student with little experence in programmin but loves music and audio in general, because of this my library of CDs (and electronic copies of those CDs) have piled up quite a bit... so much so that it has become a bit of a burden to keep everything in the laptop that I have with me at all times. As a result, I decided to put all of my music on a network drive but that didn't work very well music library managers. This is where my music comes into play, where audio played through a web-based interface.

##Prerequisites:
nodejs 0.10.26<br />
ffmpeg 2.2.4<br />
Other dependencies should be installed by running "npm install" in the working directory.<br />
A file named "settings.json" should be placed in the working directory.<br />
Example settings.json content:<br />
```
{
	"httpPort": "8080",
	"subDomain": "/",
	"musicDir": "/path/to/my_music/",
	"databasePath": "./library.db",
	"imgPath": "./img/_default.jpg",
	"imgDir": "./img/",
	"allowDownload": "yes"
}
```
"imgPath" is the path to the default album image used by the player.<br />
"imgDir" is where all the album artwork will be stored.<br />

##Usage:<br />
To build the music database for the first time, use:
```node main.js (-b|-build)```<br />
To update database with new or removed files, use:
```node main.js (-u|-update)```<br />
To start using player, use:
```node main.js```
