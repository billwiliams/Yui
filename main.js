
//Modules -------------------------------------------------------------------
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var sqlite3 = require('sqlite3').verbose();
var fs = require('graceful-fs');
var fsPath = require('path');
var crc = require('crc');
var childProcess = require('child_process');
//My Modules -------------------------------------------------------------------
var dbBuilder = require('./my_modules/db_builder');
var dlCreator = require('./my_modules/dl_creator');

//Setup -------------------------------------------------------------------
var settings = JSON.parse(fs.readFileSync('./settings.json'));

//check temp folder
if(!fs.existsSync('./temp')) fs.mkdirSync('./temp');
//open log
var logger = fs.createWriteStream(settings.logPath, {flags: 'w'});

//parse argv
var argList = process.argv.slice(2);
var buildDatabase = 'no';
for(var i = 0; i < argList.length; i++) {
	if(/\-(build|b)/i.test(argList[i])) {
		buildDatabase = 'build';
	}
	if(/\-(update|u)/i.test(argList[i])) {
		buildDatabase = 'update';
	}
}
if(buildDatabase === 'build') {
	dbBuilder.build(settings);
} else if(buildDatabase === 'update') {
	dbBuilder.update(settings);
}

//Open DB
var db = new sqlite3.Database(settings.databasePath);


//Main -------------------------------------------------------------------

var genreRegex = '';
var genreList = [];
db.all("SELECT DISTINCT genre FROM music", function(err, genres) {
	if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
	if(genres && genres.length > 0) {
		// fill genre list
		if(genres.length > 1) {
			for (var i = 0; i < genres.length; i++) {
				genreList.push(genres[i].genre + ': %');
            }
		} else {
			genreList.push(genres.genre + ': %');
		}
		// generate genre regex
		genreRegex = '^(';
		for (var i = 0; i < genres.length; i++) {
			genreRegex += genres[i].genre.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
			if(i != genres.length-1) genreRegex += '|';
		}
		genreRegex += '):\\s';
		genreRegex = new RegExp(genreRegex, 'i');
	} 
});

//HTTP Server behaviour
app.get(settings.subDomain, function(req, res) {
	res.sendfile('./client/index.html');
	logger.write('('+ new Date().toString() +') '+'[HTTP] Request '+req.url+' from: '+ req.ip +'\n');
});
// Basic Auth
if(settings.useAuth === 'yes') app.use(express.basicAuth('username', 'password'));
// Serve content
app.use(function(req, res, next) {
	logger.write('('+ new Date().toString() +') '+'[HTTP] '+ req.ip +' '+ req.method + ' ' + req.url +'\n');
	// check for correct URL
	if(req.url.search(settings.subDomain) != -1) {
		req.url = req.url.replace(settings.subDomain, '/');
		// check for audio request with '/dat' in URL
		if(/^\/dat/i.test(req.url)) {
			var file = req.url.replace(/^\/dat/i, '') + '.wav';
			// check if audio file exixts
			if(fs.existsSync('./temp'+ file)) {
				if(req.method === 'HEAD') {
					res.header({
						'Content-Type': 'audio/wav',
						'Content-Length': fs.statSync('./temp'+ file).size
					});
					res.send(200);
				}
				if (req.method === 'GET') {
					res.sendfile(process.cwd() +'/temp'+ file);
				}
			} else {
				res.send(404, '404: Not Found.');
			}
		}
		// check for download request with '/dl' in URL
		else if(/^\/dl/i.test(req.url)) {
			path = './temp'+ req.url.replace(/^\/dl/i, '');
			console.log(path);
			res.header('Content-Type', 'application/force-download');
		    res.header('Content-Type', 'application/octet-stream');
		    res.attachment();
			res.download(path, function(err) {
				logger.write('('+ new Date().toString() +') '+'[HTTP] Download complete: '+ path +'\n');
				if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				fs.unlink(path, function(err) {
					if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				});
			});
		} else {
			// handel other file requests 
			if (req.method === 'GET') {
				res.sendfile(process.cwd() +'/client'+ req.url);
			}
		}
	} else {
		res.send(404, '404: Not Found.');
	}
});

//Socket connections
io.on('connection', function(socket) {
	logger.write('('+ new Date().toString() +') '+'[Socket] Client connected: '+socket.id +'\n');
	// Client fields
	var activeAudioFile = null;
	var albumBuffer = [];
	var activeFilters = '';
	var dlPreparing = false;
	// Delete audio file on disconnect
	socket.on('disconnect', function() {
		if(activeAudioFile) fs.unlink(activeAudioFile, function(err){
			if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
			activeAudioFile = null;
		});
	});
	// Download album request
	socket.on("request download", function(album) {
		if(settings.allowDownload === 'yes' && !dlPreparing) {
			logger.write('('+ new Date().toString() +') '+'[Socket] Download album: '+ album +'\n');
			dlPreparing = true;
			db.all("SELECT file FROM music WHERE album='"+ album.replace(/\'/g, "''") +"'", function(err, fileList) {
				if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				var files = [];
				for (var i = 0; i < fileList.length; i++) {
					files.push(fileList[i].file);
				}
				dlCreator.create(files, album, function(path) {
					dlPreparing = false;
					socket.emit('download link', {
						path: path,
						album: album
					});
				})
			});
		} else if(dlPreparing) {
			socket.emit('download link', {
				path: 'preparing',
				album: album
			});
		} else {
			socket.emit('download link', {
				path: 'rejected',
				album: album
			});
		}
	});
	// Send new playlist
	socket.on("request playlist", function(id) {
		db.get("SELECT album,track FROM music WHERE id='"+ id +"'", function(err, current) {
			db.all("SELECT track,disk,title,artist,id FROM music WHERE album='"+ current.album.replace(/\'/g, "''") +
					"' ORDER BY disk,track", function(err, playlist) {
				var packet = [];
				packet.push(id);
				for (var i = 0; i < playlist.length; i++) {
					packet.push(playlist[i]);
				}
				socket.emit('track playlist', packet);
			});
		});
	});
	// Prepare audio file for playback
	socket.on("request track", function(id) {
		db.get("SELECT title,album,albumId,artist,genre,file FROM music WHERE id='"+ id +"'", function(err, trackData) {
			if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
			logger.write('('+ new Date().toString() +') '+'[Socket] Request Track ['+id+'] '+trackData.title +'\n');
			// send track metadata
			var ffprobe = childProcess.spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', trackData.file]);
			var ffprobeOut = '';
			ffprobe.stdout.setEncoding('utf8');
			ffprobe.stdout.on('data', function(data) {
				ffprobeOut += data + '\n';
			});
			ffprobe.on('close', function(code) {
				var probeData = JSON.parse(ffprobeOut);
				probeData = probeData.streams[0];
				var imgData = '';
				var imgPath = settings.imgDir + trackData.albumId + '.jpg';
				if(fs.existsSync(imgPath)) {
					imgData = fs.readFileSync(imgPath).toString('base64');
				}
				socket.emit('track info', {
					image: imgData,
					Title: trackData.title,
					Album: trackData.album,
					Artist: trackData.artist,
					Genre: trackData.genre,
					File: fsPath.basename(trackData.file),
					Codec: probeData.codec_long_name,
					BitRate: probeData.bit_rate,
					Format: probeData.sample_fmt,
					SampleRate: probeData.sample_rate,
					Channel: probeData.channel_layout
				});
			});
			// prepare path for new audio file 
			var timeStamp = new Date().getTime().toString(16);
			var destPath = './temp/'+id+'-'+timeStamp+'.wav';
			if(activeAudioFile) {
				fs.unlinkSync(activeAudioFile);
			}
			activeAudioFile = destPath;
			// create new audio file with ffmpeg
			var ffmpeg = childProcess.spawn('ffmpeg', ['-i', trackData.file, '-y', destPath]);
			var buffer = '';
			ffmpeg.stdout.setEncoding('utf8');
			ffmpeg.stderr.setEncoding('utf8');
			ffmpeg.stderr.on('data', function(data) {
				buffer += data + '\n';
			});
			ffmpeg.on('close', function(code) {
				if(code) {
					logger.write('('+ new Date().toString() +') '+'[ffmpeg] Error:' +'\n');
					logger.write('('+ new Date().toString() +') '+buffer +'\n');
				} else {
					// send link to new audio file
					socket.emit('track data', {
						file: destPath.replace('./temp/', '').replace(/\.wav/i, ''),
						title: trackData.title
					});
				}
			});
		});
	});
	// Search
	socket.on('search', function(search) {
		var genreFilter = search.match(genreRegex);
		search = search.replace(genreRegex, '');
		var query = "SELECT DISTINCT albumId FROM music WHERE ";
		if(genreFilter) {
			genreFilter = genreFilter[0].replace(/:\s$/i, '');
			query += "genre LIKE '"+ genreFilter +"' AND";
			logger.write('('+ new Date().toString() +') '+'[Socket] Search: "'+ search +'" in "'+ genreFilter +'"' +'\n');
		} else {
			logger.write('('+ new Date().toString() +') '+'[Socket] Search: '+ search +'\n');
		}
		query += "( title LIKE '%"+ search.replace(/\'/g, "''") +"%' OR ";
		query += "album LIKE '%"+ search.replace(/\'/g, "''") +"%' OR ";
		query += "artist LIKE '%"+ search.replace(/\'/g, "''") +"%' ) ";
		query += "ORDER BY album COLLATE NOCASE";
		db.all(query, function(err, albums) {
			if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
			albumBuffer = albums;
			activeFilters = search.replace(/\'/g, "''");
			SendAlbums();
		});
	});
	// Initialize client
	socket.on("init", function() {
		socket.emit('genre list', genreList);
		db.all("SELECT DISTINCT albumId FROM music ORDER BY album COLLATE NOCASE", function(err, albums) {
			if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
			albumBuffer = albums;
			SendAlbums();
		});
	});
	// more albums
	socket.on("more albums", function() {
		SendAlbums();
	});
	// Send albums function, send 5 albums from [albumBuffer] on request.
	function SendAlbums() {
		var i = 5;
		while(i--) {
			if(albumBuffer.length != 0) {
				db.get("SELECT album,albumId,genre FROM music " +
						"WHERE albumId='"+albumBuffer[0].albumId + "'",
						function(err, albumInfo) {
					if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');

					var albumPacket = [];
					var imgData;
					var imgPath = settings.imgDir + albumInfo.albumId + '.jpg';
					if(fs.existsSync(imgPath)) {
						imgData = fs.readFileSync(imgPath).toString('base64');
					} else {
						imgData = fs.readFileSync(settings.imgPath).toString('base64');
					}
					albumPacket.push({
						album: albumInfo.album,
						genre: albumInfo.genre,
						image: imgData,
						allowDownload: settings.allowDownload
					});

					var query = "SELECT title,artist,track,disk,id FROM music ";
					query += "WHERE albumId='"+ albumInfo.albumId +"' AND ( ";
					query += "album LIKE '%"+ activeFilters +"%' OR ";
					query += "title LIKE '%"+ activeFilters +"%' OR ";
					query += "artist LIKE '%"+ activeFilters +"%' ) ";
					query += "ORDER BY track";
					db.all(query, function(err, tracks) {
						if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
						for (var i = 0; i < tracks.length; i++) {
							albumPacket.push(tracks[i]);
						}
						logger.write('('+ new Date().toString() +') '+'[Socket] Sending Album: ' + albumPacket[0].album +'\n');
						socket.emit("new album", albumPacket);
					});	
				});
				albumBuffer.shift();
			}
		}
	}
});


//Start HTTP server
if(buildDatabase === 'no') {
	http.listen(settings.httpPort, function() {
		logger.write('('+ new Date().toString() +') '+'[HTTP] Server listening on Port: ' + settings.httpPort +'\n');
	});
}

//END OF FILE ----------------------------------------------------

