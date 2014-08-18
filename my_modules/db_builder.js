
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
function Metadata(imgPath) {
	this.title = 'Untitled';
	this.artist = 'Unknown Artist';
	this.album = 'Unknown Album';
	this.genre = 'Unknown Genre';
	this.track = 1;
	this.disk = 0;
}

//Functions ---------------------------------------------------------------------

function processFile(scanResult, currentFileIndex, settings, sql, callback) {
	var trackID = scanResult[currentFileIndex].id
	// path to metadata files from ffmpeg
	var metaPath = process.cwd() +'/temp/'+ trackID +'.txt';
	// Get metadata using ffmpeg
	var ffmpegMeta = childProcess.spawn('ffmpeg', ['-i', scanResult[currentFileIndex].path, '-y', '-f', 'ffmetadata', metaPath]);
	var ffmpegMetaOut = '';
	ffmpegMeta.stderr.setEncoding('utf8');
	ffmpegMeta.stderr.on('data', function(data) {
		ffmpegMetaOut += data + '\n';
	});
	ffmpegMeta.on('close', function(code) {
		// check ffmpeg exit code, report error if not 0.
		if(code) {
			console.log('[ffmpeg] Metadata Error!');
			console.log(scanResult[currentFileIndex].path + 'Not Added!');
			NextFile();
		} else {
			// read metadata from txt file
			var musicMetadata = fs.readFileSync(metaPath, 'utf8');
			var metadata = new Metadata(settings.imgPath);
			var scannedData = new Metadata(settings.imgPath);
			scannedData.title = musicMetadata.match(/(?=title\=)(.*)/i);
			scannedData.album = musicMetadata.match(/(?=album\=)(.*)/i);
			scannedData.artist = musicMetadata.match(/(?=artist\=)(.*)/i);
			scannedData.genre = musicMetadata.match(/(?=genre\=)(.*)/i);
			scannedData.disk = musicMetadata.match(/(?=disc\=)(.*)/i);
			scannedData.track = musicMetadata.match(/(?=track\=)(.*)/i);
			if(scannedData.title) metadata.title = scannedData.title[0].replace(/title=/i, '');
			if(scannedData.album) metadata.album = scannedData.album[0].replace(/album=/i, '');
			if(scannedData.artist) metadata.artist = scannedData.artist[0].replace(/artist=/i, '');
			if(scannedData.genre) metadata.genre = scannedData.genre[0].replace(/genre=/i, '');
			if(scannedData.disk) {
				metadata.disk = scannedData.disk[0].replace(/disc=/i, '').replace(/(?=\/)(.*)/i, '');
				metadata.disk = parseInt(metadata.disk, 10);
			}
			if(scannedData.track) {
				metadata.track = scannedData.track[0].replace(/track=/i, '').replace(/(?=\/)(.*)/i, '');
				metadata.track = parseInt(metadata.track, 10);
			}
			var albumID = crc.crc32(metadata.album + fsPath.dirname(scanResult[currentFileIndex].path));
			var imgPath = settings.imgDir + albumID + '.jpg';
			// Convert album image using ffmpeg
			var ffmpegImg = childProcess.spawn('ffmpeg', ['-i', scanResult[currentFileIndex].path, '-y', '-vf', 'scale=-1:400', imgPath]);
			var ffmpegImgOut = '';
			ffmpegImg.stderr.setEncoding('utf8');
			ffmpegImg.stderr.on('data', function(data) {
				ffmpegImgOut += data + '\n';
			});
			ffmpegImg.on('close', function(code) {
				if(code) {
					console.log('[ffmpeg] Error getting Album Art!');
				}
				// Check if song already exist by matching title and album
				sql.query("SELECT title FROM music WHERE title=? AND album=? AND artist=?",
						[metadata.title.replace(/\'/g, "\'"), 
						 metadata.album.replace(/\'/g, "\'"), 
						 metadata.artist.replace(/\'/g, "\'")])
						.on('result', function(result) {
							result.on('error', function(err) {
								console.error(err);
							})
							.on('row', function(row) {
								// Delete song from DB if already exists
								console.log('[SQL] Replacing '+metadata.title);
								sql.query("DELETE FROM music WHERE title=? AND album=? AND artist=?", 
										[metadata.title.replace(/\'/g, "\'"), 
										 metadata.album.replace(/\'/g, "\'"), 
										 metadata.artist.replace(/\'/g, "\'")]);
							});
						})
						.on('end', function() {
							// Add song to database
							sql.query("INSERT INTO music (file, title, artist, album, genre, track, disk, albumId, id) "
									+ "VALUES (:file, :title, :artist, :album, :genre, :track, :disk, :albumId, :id)", {
										file:	scanResult[currentFileIndex].path.replace(/\'/g, "\'"),
										title:	metadata.title.replace(/\'/g, "\'"),
										artist:	metadata.artist.replace(/\'/g, "\'"),
										album:	metadata.album.replace(/\'/g, "\'"),
										genre:	metadata.genre.replace(/\'/g, "\'"),
										track:	metadata.track,
										disk:	metadata.disk,
										albumId: albumID,
										id: trackID,
									});
							console.log("[SQL] Add Entry #"+ (scanResult.length - currentFileIndex) +": "+ trackID);
							NextFile();
						});
			});
		}
		function NextFile() {
			// delete metadata file from temp folder
			if(fs.existsSync(metaPath)) {
				fs.unlink(metaPath, function(err) {
					if(err) console.error(err);
				});
			}
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
				process.exit(0);
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
				// file search complete
				console.log('[FS] Scan Complete, Found: ' + scanResult.length);
				// Delete all files in temp folder
				var remover = find(process.cwd() +'/temp/');
				remover.on('file', function(filePath, stat) {
					fs.unlink(filePath, function(err) {
						if(err) console.error(err);
					})
				});
				remover.on('error', function(err) {
					console.error(err);
					remover.stop();
					process.exit(0);
				});
				remover.on('end', function() {
					// determine unchanged entries
					for (var i = 0; i < scanResult.length; i++) {
						if(idList.length > 0) {
							// binary search [idList] to find duplicate entries
							var target = parseInt(scanResult[i].id, 16);
							var min = 0, max = idList.length - 1;
							var index = Math.floor((max+min)/2);
							while(target != parseInt(idList[index].id, 16) && max > min) {
								if(target > parseInt(idList[index].id, 16)) min = index + 1;
								else if(target < parseInt(idList[index].id, 16)) max = index - 1;
								index = Math.floor((max+min)/2);
							}
							if(target == parseInt(idList[index].id, 16)) {
								scanResult.splice(i, 1);
								idList.splice(index, 1);
								i--;
							}
						}
					}
					// Delete Entries
					while(idList.length > 0) {
						console.log('Delete Entry #'+ idList.length +': '+ idList[idList.length - 1].id);
						sql.query("DELETE FROM music WHERE id = ?", [idList[idList.length - 1].id]);
						idList.pop();
					}
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
		sql.query("CREATE TABLE music (" +
				"file		VARCHAR(255)," +
				"title		VARCHAR(255)," +
				"artist		VARCHAR(255)," +
				"album		VARCHAR(255)," +
				"genre		VARCHAR(255)," +
				"track		TINYINT UNSIGNED," +
				"disk		TINYINT UNSIGNED," +
				"albumId	CHAR(8)," +
				"id			CHAR(8) )" +
				"CHARACTER SET 'utf8'");
		// start searching filesystem for audio files...
		console.log('[FS] Search Begin...');
		var scanResult = [];
		var finder = find(settings.musicDir);
		finder.on('error', function(err) {
			// stop build process on error
			console.error(err);
			finder.stop();
			process.exit(0);
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
			var currentFileIndex = scanResult.length - 1;
			// Delete all files in temp folder
			var remover = find(process.cwd() +'/temp/');
			remover.on('file', function(filePath, stat) {
				fs.unlink(filePath, function(err) {
					if(err) console.error(err);
				})
			});
			remover.on('error', function(err) {
				console.error(err);
				remover.stop();
				process.exit(0);
			});
			remover.on('end', function() {
				// temp folder emptied, process each file in [scanResult] array in a recursion loop about function [processFile()]
				processFile(scanResult, scanResult.length - 1, settings, sql, function() {
					clearTimeout(timer);
					console.log('Total running time: '+ (Math.floor(processingTime*100)/100) +' sec');
					console.log('[SQL] Database build complete!');
					sql.end();
				});
			});
		});
	});
}


//END OF FILE ----------------------------------------------------

