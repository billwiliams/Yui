
//Modules -------------------------------------------------------------------
var maria = require('../node_modules/mariasql');
var fs = require('../node_modules/graceful-fs');
var path = require('path');
var crc = require('crc');

exports.organize = function(settings, outDir) {
	if(!fs.existsSync(outDir)) {
		console.log('Error: '+ outDir +' does not exist!');
		process.exit(0);
	}
	settings.musicDir = outDir;
	fs.writeFileSync('./settings.json', JSON.stringify(settings ,null ,"\t"));
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
		console.log('FS Organization Done!');
		process.exit(0);
	})
	.on('connect', function() {
		var fileList = [];
		sql.query("SELECT file,genre,album,disk,track,title,id FROM music LEFT JOIN album ON music.album_id = album.album_id")
		.on('result', function(result) {
			result.on('error', function(err) {
				console.error(err);
			})
			.on('row', function(row) {
				fileList.push(row);
			});
		})
		.on('end', function() {
			sql.query("SET FOREIGN_KEY_CHECKS = 0");
			console.log('Move '+ fileList.length +' files...')
			for (var i = 0; i < fileList.length; i++) {
				var current = fileList[i];
				if(fs.existsSync(current.file)) {
					var outPath = path.join(outDir, current.genre.replace(/\//g, '\\'));
					if(!fs.existsSync(outPath)) fs.mkdirSync(outPath);
					outPath = path.join(outPath, current.album.replace(/\//g, '\\'));
					if(!fs.existsSync(outPath)) fs.mkdirSync(outPath);
					outPath = path.join(outPath, (current.disk+'-'+current.track+'-'+current.title+path.extname(current.file)).replace(/\//g, '\\'));
					if(outPath != current.file) {
						console.log('Move: #'+ (i+1) +' '+ current.file);
						fs.renameSync(current.file, outPath);
						var albumId = crc.crc32(current.album + path.dirname(outPath));
						var trackId = crc.crc32(outPath);
						
						sql.query("UPDATE music LEFT JOIN album ON music.album_id = album.album_id " +
								"SET id=:id, file=:outFile, albumId=:albumId WHERE id=:oldID", {
							id: trackId,
							albumId: albumId,
							outFile: outPath.replace(/\'/g, "\'"),
							oldID: current.id
						});
					} 
				} else {
					console.log(current.file +' does not exist, skipping.');
				}
			}
			console.log('Updating database...');
			sql.query("SET FOREIGN_KEY_CHECKS = 1");
			sql.end();
		});	
	});
}


// END OF FILE ----------------------------------------------

