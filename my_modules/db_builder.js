
/* Notes:
 * albumId computed by CRC32 of album name + folder path
 * trackId computed by CRC32 of file path
 */

//Modules -------------------------------------------------------------------
var maria = require('../node_modules/mariasql');
var find = require('../node_modules/findit');
var fs = require('../node_modules/graceful-fs');
var crc = require('../node_modules/crc');
var fsPath = require('path');
var childProcess = require('child_process');

//Constructors -------------------------------------------------------------------
function musicEntry() {
	this.file = null;
	this.title = 'Untitled';
	this.artist = 'Unknown Artist';
	this.codec = null;
	this.format = null;
	this.bitRate = null;
	this.sampleRate = null;
	this.track = 1;
	this.disk = 0;
	this.id = null;
}
function albumEntry() {
	this.albumId = null;
	this.album = 'Unknown Album';
	this.genre = 'Unknown Genre';
	this.image = null;
}


//Functions ---------------------------------------------------------------------

//binary search array
function binSearch(array, comp) {
	var min = 0, max = array.length - 1;
	var index, result, match = false;
	do {
		index = Math.floor((max+min)/2);
		result = comp(array[index]);
		if(result == 1) max = index - 1;
		if(result == -1) min = index + 1;
	} while(result != 0 && max >= min);
	if(result == 0) match = true;
	return {index:index, match:match};
}

// Add file to DB
function processFile(scanResult, currentFileIndex, settings, sql, callback) {
	var current = scanResult[currentFileIndex];
	// Get metadata using ffprobe
	var ffprobe = childProcess.spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', current.path]);
	var ffprobeOut = '';
	ffprobe.stdout.setEncoding('utf8');
	ffprobe.stdout.on('data', function(data) {
		ffprobeOut += data + '\n';
	});
	ffprobe.on('close', function(code) {
		if(code) {
			console.log('[ffprobe] Error reading metadata!');
			console.log(current.path + 'Not Added!');
			NextFile();
		} else {
			// Parse ffprobe output
			var probeOutput = JSON.parse(ffprobeOut);
			var probeStream = probeOutput.streams[0];
			var unparsedTags = probeOutput.format.tags;
			var probeTags = {};
			for (var key in unparsedTags) {
				probeTags[key.toLowerCase()] = unparsedTags[key];
            }
			var albumID = crc.crc32(probeTags.album + fsPath.dirname(current.path));
			var musicMeta = new musicEntry();
			var albumMeta = new albumEntry();
			musicMeta.file = current.path;
			if(probeTags.title)				musicMeta.title = probeTags.title.replace(/\'/g, "\'");
			if(probeTags.artist)			musicMeta.artist = probeTags.artist.replace(/\'/g, "\'");
			if(probeStream.codec_long_name)	musicMeta.codec = probeStream.codec_long_name.replace(/\'/g, "\'");
			if(probeStream.sample_fmt)		musicMeta.format = probeStream.sample_fmt.replace('s', 'Signed ').replace('u', 'Unsigned ') + '-bit';
			if(/p/i.test(musicMeta.format))	musicMeta.format = musicMeta.format.replace('p', '') + ', Planar';
			if(probeStream.bit_rate)		musicMeta.bitRate = parseInt(probeStream.bit_rate, 10);
			if(probeStream.sample_rate)		musicMeta.sampleRate = parseInt(probeStream.sample_rate, 10);
			if(probeTags.track)				musicMeta.track = parseInt(probeTags.track.replace(/(?=\/)(.*)/i, ''), 10);
			// NOTE: ffprobe outputs 'disc' instead of 'disk'!
			if(probeTags.disc)				musicMeta.disk = parseInt(probeTags.disc.replace(/(?=\/)(.*)/i, ''), 10);
			musicMeta.id = current.id;
			// Check for existing album info
			var albumExists = null;
			sql.query("SELECT album_id FROM album WHERE albumId=?", [albumID])
			.on('result', function(result) {
				result.on('error', function(err) {console.error(err);})
				.on('row', function(row) {albumExists = row;});
			})
			.on('end', function() {
				if(!albumExists) {
					// Get album image using ffmpeg
					var imageData = [];
					var ffmpeg = childProcess.spawn('ffmpeg', ['-i', current.path, '-y', '-vf', 'scale=-1:500', 'pipe:1.jpg']);
					ffmpeg.stdout.on('data', function(data) {
						imageData.push(data);
					});
					ffmpeg.on('close', function(code) {
						albumMeta.albumId = albumID;
						if(probeTags.album) albumMeta.album = probeTags.album.replace(/\'/g, "\'");
						if(probeTags.genre) albumMeta.genre = probeTags.genre.replace(/\'/g, "\'");
						if(!code) {
							imageData = Buffer.concat(imageData);
							console.log("[SQL] Add Album: "+ albumMeta.album);
							albumMeta.image = imageData.toString('hex');
						} else {
							console.log("[SQL] Add Album: [NO ARTWORK] "+ albumMeta.album);
							albumMeta.image = fs.readFileSync(settings.imgPath).toString('hex');
						}
						sql.query("INSERT INTO album (albumId, album, genre, image) "
								+ "VALUES (:albumId, :album, :genre, x:image)", albumMeta);
						sql.query("SELECT album_id FROM album WHERE albumId=?", [albumID])
						.on('result', function(result) {
							result.on('error', function(err) {console.error(err);})
							.on('row', function(row) {AddFile(row.album_id);});
						});
					});
				} else {
					AddFile(albumExists.album_id);
				}
				function AddFile(album_id) {
					// Add file to database
					console.log("[SQL] Add File #"+ (scanResult.length - currentFileIndex) +": "+ fsPath.basename(current.path));
					sql.query("INSERT INTO music (file, title, artist, codec, format, bitRate, sampleRate, track, disk, id, album_id) "
							+ "SELECT :file, :title, :artist, :codec, :format, :bitRate, :sampleRate, :track, :disk, :id, "+ album_id, musicMeta);
					NextFile();
				}
			});
		}
		function NextFile() {
			// process next file
			currentFileIndex--;
			if(currentFileIndex >= 0) {
				processFile(scanResult, currentFileIndex, settings, sql, callback);
			} else {
				callback();
			}
		}
	});
}

//Exports ------------------------------------------------------------------------------------

//--- Update Database ---
exports.update = function(settings) {
	// Connect to DB
	var sql = new maria();
	sql.connect({
		host: settings.db.host,
		db: settings.db.db,
		user: settings.db.username,
		password: settings.db.password
	});
	sql.on('error', function(err) {
		console.error(err);
	})
	.on('close', function() {
		process.exit(0);
	})
	.on('connect', function() {
		// setup build time counter
		var processingTime = 0;
		var timer = setInterval(function() {
			processingTime += 0.01;
		}, 10);
		console.log('[SQL] Updating Database...');
		// Dump all existing track IDs
		var idList = [];
		sql.query("SELECT id FROM music ORDER BY id")
		.on('result', function(result) {
			result.on('error', function(err) {
				console.error(err);
			})
			.on('row', function(row) {
				idList.push(row);
			});
		})
		.on('end', function() {
			// start searching filesystem for audio files...
			console.log('[FS] Search Begin...');
			var scanResult = [];
			var finder = find(settings.musicDir);
			finder.on('error', function(err) {
				// stop build process on error
				console.error(err);
				finder.stop();
				sql.end();
			});
			finder.on('file', function(filePath, stat) {
				// test for audio file types
				if (!(/.*\/\..*/i.test(filePath)) && /\.(mp3|m4a|aiff|aif|aac|flac|wav|ape|ogg)$/i.test(filePath)) {
					// compute track ID
					var trackID = crc.crc32(filePath);
					// store audio file path in array
					scanResult.push({
						id: trackID,
						path: filePath
					});
				}
			});
			finder.on('end', function() {
				console.log('[FS] Scan Complete, Found: ' + scanResult.length);
				// determine unchanged entries
				for (var i = 0; i < scanResult.length; i++) {
					if(idList.length > 0) {
						// search [idList] to find duplicate entries
						var target = parseInt(scanResult[i].id, 16);
						var result = binSearch(idList, function(a) {
							var value = parseInt(a.id, 16);
							if(value > target) return 1;
							if(value < target) return -1;
							return 0;
                        });
						if(result.match) {
							scanResult.splice(i, 1);
							idList.splice(result.index, 1);
							i--;
						}
					}
				}
				// Delete Entries
				sql.query("SET FOREIGN_KEY_CHECKS = 0");
				while(idList.length > 0) {
					console.log('Delete Entry #'+ idList.length +': '+ idList[idList.length - 1].id);
					sql.query("DELETE music,album FROM music LEFT JOIN album ON music.album_id = album.album_id" +
							" WHERE id = ?", [idList[idList.length - 1].id]);
					idList.pop();
				}
				sql.query("SET FOREIGN_KEY_CHECKS = 1");
				if(scanResult.length > 0) {
					// Process files
					processFile(scanResult, scanResult.length - 1, settings, sql, function() {
						clearTimeout(timer);
						console.log('Total running time: '+ (Math.floor(processingTime*100)/100) +' sec');
						console.log('[SQL] Database update complete!');
						sql.end();
					});
				} else {
					console.log('[SQL] Database update complete!');
					sql.end();
				}
			});	
		});
	});
}

//--- Build Database ---
exports.build = function (settings) {
	// Connect to DB
	var sql = new maria();
	sql.connect({
		host: settings.db.host,
		db: settings.db.db,
		user: settings.db.username,
		password: settings.db.password
	});
	sql.on('error', function(err) {
		console.error(err);
	})
	.on('close', function() {
		process.exit(0);
	})
	.on('connect', function() {
		// setup build time counter
		var processingTime = 0;
		var timer = setInterval(function() {
			processingTime += 0.01;
		}, 10);
		console.log('[SQL] Buliding Database...');
		sql.query("DROP TABLE IF EXISTS music");
		sql.query("DROP TABLE IF EXISTS album");
		sql.query("CREATE TABLE album (" +
				"album_id	MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY," +
				"albumId	CHAR(8)," +
				"album		VARCHAR(255)," +
				"genre		VARCHAR(255)," +
				"image		MEDIUMBLOB )" +
		"CHARACTER SET 'utf8'");
		sql.query("CREATE TABLE music (" +
				"music_id	MEDIUMINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY," +
				"album_id	MEDIUMINT UNSIGNED NOT NULL," +
				"file		VARCHAR(255)," +
				"title		VARCHAR(255)," +
				"artist		VARCHAR(255)," +
				"codec		VARCHAR(255)," +
				"format		VARCHAR(255)," +
				"bitRate	MEDIUMINT UNSIGNED," +
				"sampleRate	MEDIUMINT UNSIGNED," +
				"track		TINYINT UNSIGNED," +
				"disk		TINYINT UNSIGNED," +
				"id			CHAR(8)," +
				"CONSTRAINT fk_album_id FOREIGN KEY (album_id) REFERENCES album(album_id) )" +
		"CHARACTER SET 'utf8'");
		// start searching filesystem for audio files...
		console.log('[FS] Search Begin...');
		var scanResult = [];
		var finder = find(settings.musicDir);
		finder.on('error', function(err) {
			// stop build process on error
			console.error(err);
			finder.stop();
			sql.end();
		});
		finder.on('file', function(filePath, stat) {
			// test for audio file types
			if (!(/.*\/\..*/i.test(filePath)) && /\.(mp3|m4a|aiff|aif|aac|flac|wav|ape|ogg)$/i.test(filePath)) {
				// compute track ID
				var trackID = crc.crc32(filePath);
				// store audio file path in array
				scanResult.push({
					id: trackID,
					path: filePath
				});
			}
		});
		finder.on('end', function() {
			// file search complete, start extracting data...
			console.log('[FS] Scan Complete, Found: ' + scanResult.length);
			if(scanResult.length == 0) {
				console.log('[SQL] Database build complete!');
				sql.end();
			} else {
				var currentFileIndex = scanResult.length - 1;
				// Process each file in [scanResult] array in a recursion loop about function [processFile()]
				processFile(scanResult, scanResult.length - 1, settings, sql, function() {
					clearTimeout(timer);
					console.log('Total running time: '+ (Math.floor(processingTime*100)/100) +' sec');
					console.log('[SQL] Database build complete!');
					sql.end();
				});
			}
		});
	});
}


//END OF FILE ----------------------------------------------------

