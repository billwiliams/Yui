
//Modules -------------------------------------------------------------------
var fs = require('fs');
var childProcess = require('child_process');


//Main -------------------------------------------------------------------

exports.create = function(fileList, albumId, callback) {
	var zipArgs = ['a', '-tzip', '-aoa', '-mmt', '-y', './temp/'+ albumId +'.zip'];
	for (var i = 0; i < fileList.length; i++) zipArgs.push(fileList[i]);
	var zip = childProcess.spawn('7z', zipArgs);
	zip.on('close', function(code) {
		if(code) console.error('[Zip] Error code: '+code);
		callback(albumId +'.zip');
	});
}