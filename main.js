
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
var querystring = require('querystring');
//My Modules -------------------------------------------------------------------
var dbBuilder = require('./my_modules/db_builder.js');
var dlCreator = require('./my_modules/dl_creator.js');
var fsOrganizer = require('./my_modules/fs_organizer.js');

//Setup -------------------------------------------------------------------
var settings = JSON.parse(fs.readFileSync('./settings.json'));

//check temp folder
if(!fs.existsSync('./temp')) fs.mkdirSync('./temp');
//open log
var logger = fs.createWriteStream(settings.logPath, {flags: 'w'});

//parse argv
var argList = process.argv.slice(2);
var buildDatabase = 'no';
var newLibPath;
for(var i = 0; i < argList.length; i++) {
	if(/\-(build|b)/i.test(argList[i])) {
		buildDatabase = 'build';
	}
	if(/\-(update|u)/i.test(argList[i])) {
		buildDatabase = 'update';
	}
	if(/\-(move|m)/i.test(argList[i])) {
		buildDatabase = 'organize';
		newLibPath = argList[i+1];
	}
	if(/\-(organize|o)/i.test(argList[i])) {
		buildDatabase = 'organize';
		newLibPath = settings.musicDir;
	}
}
if(buildDatabase === 'build') {
	dbBuilder.build(settings);
} else if(buildDatabase === 'update') {
	dbBuilder.update(settings);
} else if(buildDatabase === 'organize') {
	fsOrganizer.organize(settings, newLibPath);
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
				genreList.push(genres[i].genre + ': ');
            }
		} else {
			genreList.push(genres.genre + ': ');
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
if(settings.useAuth === 'yes') app.use(express.basicAuth(settings.username, settings.password));
app.use(function(req, res, next) {
	req.url = querystring.unescape(req.url);
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
			var path = './temp'+ req.url.replace(/^\/dl/i, '');
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
	socket.emit('socket created', {
		hostname: settings.hostname,
		genreList: genreList
	});
	// Client fields
	var activeAudioFile = null;
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
	socket.on("request download", function(albumId) {
		if(settings.allowDownload === 'yes' && !dlPreparing) {
			logger.write('('+ new Date().toString() +') '+'[Socket] Download album: '+ albumId +'\n');
			dlPreparing = true;
			db.all("SELECT file FROM music WHERE albumId='"+ albumId +"'", function(err, fileList) {
				if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				var files = [];
				for (var i = 0; i < fileList.length; i++) {
					files.push(fileList[i].file);
				}
				dlCreator.create(files, albumId, function(path) {
					dlPreparing = false;
					socket.emit('download link', {
						path: fsPath.join('dl', path),
						albumId: albumId
					});
				})
			});
		} else if(dlPreparing) {
			socket.emit('download link', {
				path: 'preparing',
				albumId: albumId
			});
		} else {
			socket.emit('download link', {
				path: 'rejected',
				albumId: albumId
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
		var query = "SELECT DISTINCT album,albumId FROM music WHERE ";
		var msg = '';
		if(genreFilter) {
			genreFilter = genreFilter[0].replace(/:\s$/i, '');
			query += "genre LIKE '"+ genreFilter +"' AND";
			msg = '"'+ search +'" in "'+ genreFilter +'"';
		} else {
			msg = '"'+ search +'"';
		}
		logger.write('('+ new Date().toString() +') '+'[Socket] Search: '+ msg +'\n');
		query += "( title LIKE '%"+ search.replace(/\'/g, "''") +"%' OR ";
		query += "album LIKE '%"+ search.replace(/\'/g, "''") +"%' OR ";
		query += "artist LIKE '%"+ search.replace(/\'/g, "''") +"%' ) ";
		query += "ORDER BY album COLLATE NOCASE";
		db.all(query, function(err, result) {
			if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
			activeFilters = search.replace(/\'/g, "''");
			socket.emit('search end', {
				query: msg,
				result: result,
				allowDownload: settings.allowDownload
			});
		});
	});
	// get album
	socket.on("get album", function(albumID) {
		var albumPacket = [];
		var imgData;
		var imgPath = settings.imgDir + albumID + '.jpg';
		if(fs.existsSync(imgPath)) {
			imgData = fs.readFileSync(imgPath).toString('base64');
		} else {
			imgData = fs.readFileSync(settings.imgPath).toString('base64');
		}
		albumPacket.push({
			albumId: albumID,
			image: imgData
		});
		var query = "SELECT title,artist,track,disk,id FROM music ";
		query += "WHERE albumId='"+ albumID +"' AND ( ";
		query += "album LIKE '%"+ activeFilters +"%' OR ";
		query += "title LIKE '%"+ activeFilters +"%' OR ";
		query += "artist LIKE '%"+ activeFilters +"%' ) ";
		query += "ORDER BY track";
		db.all(query, function(err, tracks) {
			if(err) logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
			for (var i = 0; i < tracks.length; i++) {
				albumPacket.push(tracks[i]);
			}
			socket.emit("new album", albumPacket);
		});	
	});
});


//Start HTTP server
if(buildDatabase === 'no') {
	http.listen(settings.httpPort, function() {
		logger.write('('+ new Date().toString() +') '+'[HTTP] Server listening on Port: ' + settings.httpPort +'\n');
	});
}

//END OF FILE ----------------------------------------------------

