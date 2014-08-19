
//Modules -------------------------------------------------------------------
var fs = require('fs');
var fsPath = require('path');
var childProcess = require('child_process');


//Main -------------------------------------------------------------------

exports.createZip = function(fileList, albumId, logger, callback) {
	var zipArgs = ['a', '-tzip', '-aoa', '-mmt', '-y', './temp/'+ albumId +'.zip'];
	for (var i = 0; i < fileList.length; i++) zipArgs.push(fileList[i]);
	var zip = childProcess.spawn('7z', zipArgs);
	zip.on('close', function(code) {
		if(code) logger.write('('+ new Date().toString() +') '+'[7z] Error: '+ code +': '+ JSON.stringify(fileList) +'\n');
		callback(albumId +'.zip');
	});
}

exports.createWav = function(filePath, outputName, logger, callback) {
	var destPath = './temp/'+ outputName +'.wav';
	var ffmpeg = childProcess.spawn('ffmpeg', ['-i', filePath, '-y', destPath]);
	var ffmpegErr = '';
	ffmpeg.stderr.setEncoding('utf8');
	ffmpeg.stderr.on('data', function(data) {
		ffmpegErr += data + '\n';
	});
	ffmpeg.on('close', function(code) {
		if(code) {
			logger.write('('+ new Date().toString() +') '+'[ffmpeg] Error:' +'\n');
			logger.write('('+ new Date().toString() +') '+ ffmpegErr +'\n');
		} else {
			callback(destPath, outputName);
		}
	});
}

exports.getMeta = function(settings, trackData, callback) {
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
		callback({
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
}