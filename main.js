
//Modules -------------------------------------------------------------------
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var maria = require('mariasql');
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


//Main -------------------------------------------------------------------

//Open DB
var sql = new maria();
if(buildDatabase === 'no') {
	sql.connect({
		host: settings.db.host,
		db: settings.db.db,
		user: settings.db.username,
		password: settings.db.password
	});
}
sql.on('error', function(err) {
	console.error(err);
})
.on('close', function() {
	process.exit(0);
})
.on('connect', function() {

	// Get Genres
	var genreRegex = '';
	var genreList = [];
	sql.query("SELECT DISTINCT genre FROM music")
	.on('result', function(res) {
		res.on('row', function(row) {
			genreList.push(row.genre);
		})
		.on('error', function(err) {
			logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
		});
	})
	.on('end', function() {
		// generate genre-matching regex
		genreRegex = '^(';
		for (var i = 0; i < genreList.length; i++) {
			genreRegex += genreList[i].replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
			if(i != genreList.length-1) genreRegex += '|';
			genreList[i] += ': ';
		}
		genreRegex += '):\\s';
		genreRegex = new RegExp(genreRegex, 'i');
	});

	//HTTP Server behaviour
	app.get("/", function(req, res) {
		res.sendfile('./client/index.html');
		logger.write('('+ new Date().toString() +') '+'[HTTP] Request '+req.url+' from: '+ req.ip +'\n');
	});
	// Basic Auth
	if(settings.auth.use === 'yes') app.use(express.basicAuth(settings.auth.username, settings.auth.password));
	app.use(function(req, res, next) {
		req.url = querystring.unescape(req.url);
		logger.write('('+ new Date().toString() +') '+'[HTTP] '+ req.ip +' '+ req.method + ' ' + req.url +'\n');
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
	});

	//Socket connections
	io.on('connection', function(socket) {
		logger.write('('+ new Date().toString() +') '+'[Socket] Client connected: '+socket.id +'\n');
		socket.emit('socket created', {
			hostname: settings.client.hostname,
			defaultGenre: settings.client.defaultGenre,
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
			if(settings.client.allowDownload === 'yes' && !dlPreparing) {
				logger.write('('+ new Date().toString() +') '+'[Socket] Download album: '+ albumId +'\n');
				dlPreparing = true;
				var files = [];
				sql.query("SELECT file FROM music WHERE albumId=?", [albumId])
				.on('result', function(res) {
					res.on('row', function(row) {
						files.push(row.file);
					})
					.on('error', function(err) {
						logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
					});
				})
				.on('end', function() {
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
			var packet = [];
			packet.push(id);
			sql.query("SELECT track,disk,title,artist,id FROM music WHERE album = (SELECT album FROM music WHERE id=?)", [id])
			.on('result', function(res) {
				res.on('row', function(row) {
					packet.push(row);
				})
				.on('error', function(err) {
					logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				});
			})
			.on('end', function() {
				socket.emit('track playlist', packet);
			});
		});
		// Prepare audio file for playback
		socket.on("request track", function(id) {
			sql.query("SELECT title,album,albumId,artist,genre,file FROM music WHERE id=?", [id])
			.on('result', function(res) {
				res.on('error', function(err) {
					logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				})
				.on('row', function(trackData) {
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
		});
		// Search
		socket.on('search', function(search) {
			var genreFilter = search.match(genreRegex);
			search = search.replace(genreRegex, '');
			var query = "SELECT DISTINCT album,albumId FROM music WHERE ";
			var msg = '"'+ search +'"';
			if(genreFilter) {
				genreFilter = genreFilter[0].replace(/:\s$/i, '');
				query += "genre LIKE '"+ genreFilter +"' AND ";
				msg += ' in "'+ genreFilter +'"';
			}
			query += "( title LIKE '%"+ search.replace(/\'/g, "\'") +"%' OR ";
			query += "album LIKE '%"+ search.replace(/\'/g, "\'") +"%' OR ";
			query += "artist LIKE '%"+ search.replace(/\'/g, "\'") +"%' ) ";
			query += "ORDER BY album";
			logger.write('('+ new Date().toString() +') '+'[Socket] Search: '+ msg +'\n');
			var result = [];
			sql.query(query)
			.on('result', function(res) {
				res.on('row', function(row) {
					result.push(row);
				})
				.on('error', function(err) {
					logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				});
			})
			.on('end', function() {
				activeFilters = search.replace(/\'/g, "\'");
				socket.emit('search end', {
					query: msg,
					result: result,
					allowDownload: settings.client.allowDownload
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
			sql.query(query)
			.on('result', function(res) {
				res.on('row', function(row) {
					albumPacket.push(row);
				})
				.on('error', function(err) {
					logger.write('('+ new Date().toString() +') '+JSON.stringify(err) +'\n');
				})
			})
			.on('end', function() {
				socket.emit("new album", albumPacket);
			});	
		});
	});

	//Start HTTP server
	http.listen(settings.httpPort, function() {
		logger.write('('+ new Date().toString() +') '+'[HTTP] Server listening on Port: ' + settings.httpPort +'\n');
	});

});


//END OF FILE ----------------------------------------------------

