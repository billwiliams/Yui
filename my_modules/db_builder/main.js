
//Modules -------------------------------------------------------------------
var sqlite3 = require('sqlite3').verbose();
var find = require('findit');
var fs = require('graceful-fs');
var fsPath = require('path');
var crc = require('crc');
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

// Functions ---------------------------------------------------------------------

function processFile(scanResult, currentFileIndex, settings, db, callback) {
	var trackID = scanResult[currentFileIndex].id
	// path to metadata files from ffmpeg
	var metaPath = process.cwd() +'/temp/'+ trackID +'.txt';
	// Get metadata using ffmpeg
	var ffmpegMeta = childProcess.spawn('ffmpeg', ['-i', scanResult[currentFileIndex].path, '-y', '-f', 'ffmetadata', metaPath]);
	var ffmpegMetaOut = '';
	ffmpegMeta.stdout.setEncoding('utf8');
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
				db.get("SELECT title FROM music WHERE title='"+ metadata.title.replace(/\'/g, "''") +
						"' AND album='"+ metadata.album.replace(/\'/g, "''") +"'", function(err, data) {
					if(err) {
						console.error(err);
					}
					db.serialize(function() {
						// Delete song from DB if already exists
						if(data) {
							console.log('[SQL] Replacing '+metadata.title);
							db.run("DELETE FROM music WHERE title='"+ metadata.title.replace(/\'/g, "''") +
									"' AND album='"+ metadata.album.replace(/\'/g, "''") +"'");												
						}
						// Add song to database
						db.run(	"INSERT INTO music (file, title, artist, album, genre, track, disk, albumId, id) VALUES (" +
								"'" + scanResult[currentFileIndex].path.replace(/\'/g, "''")	+ "'," + 
								"'" + metadata.title.replace(/\'/g, "''")						+ "'," + 
								"'" + metadata.artist.replace(/\'/g, "''")						+ "'," + 
								"'" + metadata.album.replace(/\'/g, "''")						+ "'," + 
								"'" + metadata.genre.replace(/\'/g, "''")						+ "'," + 
								"'" + metadata.track											+ "'," +
								"'" + metadata.disk												+ "'," +
								"'" + albumID													+ "'," +
								"'" + trackID													+ "')"
								, function(err) {
							if(err) {
								console.error(err);
							}
							console.log("[SQL] Add Entry #"+ (scanResult.length - currentFileIndex) +": "+ trackID);
							NextFile();
						});
					});
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
				processFile(scanResult, currentFileIndex, settings, db, callback);
			} else {
				callback();
			}
		}
	});
}

// Exports ------------------------------------------------------------------------------------

//--- Update Database ---
exports.update = function(settings) {
	// Check database exists
	if(fs.existsSync(settings.databasePath)) {
		var db = new sqlite3.Database(settings.databasePath);
		// setup build time counter
		var processingTime = 0;
		var timer = setInterval(function() {
			processingTime += 0.01;
		}, 10);
		console.log('[SQL] Updating Database...');
		// list of existing track IDs
		db.all("SELECT id FROM music ORDER BY id", function(err, idList) {
			if(err) console.error(err);
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
					console.log('[FS] file #'+scanResult.length+' : ['+ trackID +'] '+filePath.replace(settings.musicDir,'/'));
				}
			});
			finder.on('end', function() {
				// file search complete
				console.log('[FS] Scan Complete!');
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
								console.log('[SQL] Keep Entry: '+ idList[index].id);
								scanResult.splice(i, 1);
								idList.splice(index, 1);
								i--;
							}
						}
					}
					// Delete Entries
					db.serialize(function() {
						DeleteFiles();
						function DeleteFiles() {
							if(idList.length > 0) {
								db.run("DELETE FROM music WHERE id='"+ idList[0].id +"'", function(err) {
									console.log('[SQL] Delete Entry: '+ idList[0].id);
									if(err) console.error(err);
									idList.shift();
									DeleteFiles();
								});
							} else {
								AddFiles();
							}
						}
					});
					// Add Entries
					function AddFiles() {
						if(scanResult.length > 0) {
							// Process files
							processFile(scanResult, scanResult.length - 1, settings, db, function() {
								clearTimeout(timer);
								console.log('Total running time: '+ (Math.floor(processingTime*100)/100) +' sec');
								console.log('[SQL] Database update complete!');
								process.exit(0);
                            });
						} 
					}
				});
			});
		});
	} else {
		console.error('Database file: '+ settings.databasePath +' does not exist!');
		process.exit(0);
	}
}

//--- Build Database ---
exports.build = function (settings) {
	// if database file exists, delete it.
	if(fs.existsSync(settings.databasePath)) {
		fs.unlinkSync(settings.databasePath);
	}
	var db = new sqlite3.Database(settings.databasePath);
	// setup build time counter
	var processingTime = 0;
	var timer = setInterval(function() {
		processingTime += 0.01;
	}, 10);
	console.log('[SQL] Buliding Database...');
	// Create new data table in DB
	db.run("CREATE TABLE music (" +
			"file		VARCHAR(255)," +
			"title		VARCHAR(255)," +
			"artist		VARCHAR(255)," +
			"album		VARCHAR(255)," +
			"genre		VARCHAR(255)," +
			"track		TINYINT(3)," +
			"disk		TINYINT(3)," +
			"albumId	VARCHAR(255)," +
			"id			VARCHAR(255) )",
			function(err) {
		if(err) console.error(err);
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
				console.log('[FS] file #'+scanResult.length+' : '+filePath.replace(settings.musicDir,'/'));
			}
		});
		finder.on('end', function() {
			// file search complete, start extracting data...
			console.log('[FS] Scan Complete!');
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
				processFile(scanResult, scanResult.length - 1, settings, db, function() {
					clearTimeout(timer);
					console.log('Total running time: '+ (Math.floor(processingTime*100)/100) +' sec');
					console.log('[SQL] Database build complete!');
					process.exit(0);
                });
			});
		});
	});
}


//END OF FILE ----------------------------------------------------

