
//Modules -------------------------------------------------------------------
var fs = require('fs');
var childProcess = require('child_process');


//Main -------------------------------------------------------------------

exports.create = function(fileList, albumName, callback) {
	albumName = albumName.replace(/ /g, '_');
	var zipArgs = ['./temp/'+ albumName +'.zip', '-j'];
	for (var i = 0; i < fileList.length; i++) {
		zipArgs.push(fileList[i]);
    }
	var zip = childProcess.spawn('zip', zipArgs);
	zip.on('close', function(code) {
		if(code) console.error('[Zip] Error code: '+code);
		callback(albumName +'.zip');
	});
}