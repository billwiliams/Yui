Yui
===
Web-based Music Library / Player

##Introduction:
With the myriads of music players avalible today, one may beg the question why we need yet another one. Well, the answer is a simple, none of the existing solutions avalible were able to satisfly my needs. A bit about myself - I'm a computer engineering student with little experence in programmin but loves music and audio in general, because of this my library of CDs (and electronic copies of those CDs) have piled up quite a bit... so much so that it has become a bit of a burden to keep everything in the laptop that I have with me at all times. As a result, I decided to put all of my music on a network drive but that didn't work very well music library managers. This is where my music comes into play, where audio played through a web-based interface.

##Prerequisites:
nodejs <br />
MariaDB or MySQL server <br />
ffmpeg 2.x <br />
7z (for album download only)<br />
Other dependencies should be installed by running "npm install" in the working directory.<br />
A file named "settings.json" should be placed in the working directory.<br />
Example settings.json content:<br />
```
{
	"httpPort": "39564",
	"musicDir": "/path/to/music/",
	"logPath": "./yui.log",
	"imgPath": "./default.jpg",
	"client": {
		"allowDownload": "yes",
		"hostname": "localhost",
		"defaultGenre": "Rock"
	},
	"db": {
		"host": "127.0.0.1",
		"db": "yui",
		"username": "foo",
		"password": "bar"
	},
	"auth": {
		"use": "no",
		"username": "foo",
		"password": "bar"
	}
}
```
`imgPath` is the path to the default album image used by the player.<br />
`client.hostname` is a hostname that will be displayed in the client interface, input empty string to disable feature.<br />
`client.defaultGenre` music of this genre will be loaded to clients on connect, this prevents long loading times. Input empty string to load all music on connection.<br />
`db` configures the database connection, `db.db` and `db.username` must be created on the server beforehand.<br />
`auth.use` determines of HTTP basic authentication will be used, `auth.username` and `auth.password` has no effect if `auth.use` is not set to 'yes'.<br />

##Usage:<br />
To build the music database for the first time, use: `node main.js (-b|-build)`<br />
To update database with new or removed files, use: `node main.js (-u|-update)`<br />
To organize music in the filesystem, use: `node main.js (-o|-organize)`<br />
To start using player, use: `node main.js`<br />

##Audio Files:<br />
Supported formats: `mp3|m4a|aiff|aac|flac|wav|ape|ogg`<br />
Audio files should be properly tagged, this software assumes that files of each unique album is stored in the same folder and each unique album have its own folder. Files of each unique album should have the same `album` and `genre` tags as well as the same album image embeded.

##Search Bar:<br />
By default, the search bar will match the input with song titles, album and artist names. An optional genre filter can be applied by typing an exact match of the genre name followed by ': ' at the begining. Because exact matches of genres are required, autocomplete is provided. SQL wildcards such as `%` and `_` also works in the search bar.<br />
Example query: `Rock: simple plan`
