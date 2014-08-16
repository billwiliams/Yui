
//Modules -------------------------------------------------------------------
var sqlite3 = require('../node_modules/sqlite3').verbose();
var fs = require('../node_modules/graceful-fs');
var path = require('path');
var crc = require('crc');

exports.organize = function(settings, outDir) {
	if(!fs.existsSync(outDir)) {
		console.log('Error: '+ outDir +'does not exist!');
		process.exit(0);
	}
	settings.musicDir = outDir;
	fs.writeFileSync('./settings.json', JSON.stringify(settings));
	var db = new sqlite3.Database(settings.databasePath);
	db.all("SELECT file,genre,album,disk,track,title,albumId FROM music", function(err, fileList) {
		if(err) console.log(err);
		var dbUpdates = [];
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
					var imgPath = path.join(settings.imgDir, current.albumId+'.jpg');
					if(fs.existsSync(imgPath)) {
						fs.renameSync(imgPath, path.join(settings.imgDir, albumId+'.jpg'));
					}
					dbUpdates.push("UPDATE music SET id='"+trackId+"', albumId='"+albumId+"', file='"+outPath.replace(/\'/g, "''")
							+"' WHERE file='"+current.file.replace(/\'/g, "''")+"'");
				} 
			}
		}
		console.log('Updating database...')
		db.serialize(function() {
			for (var i = 0; i < dbUpdates.length; i++) {
	            db.run(dbUpdates[i], function(err) {
	               if(err) console.log(err); 
                });
            }
			db.close(function(err) {
	            if(err) console.log(err);
	            console.log('FS Organization Done!');
	    		process.exit(0);
            });
		});
	});
}