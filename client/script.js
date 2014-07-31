
//Globals ---------------------------------------
var socket = io();
var player = document.getElementById('track-player');
var playlistArray, playlistIndex;
var currentFile = null;
var serverOnline = false;
var sessionID, pendingAlbums = 0;

//Console -------------------------------------------

function consolePrintln(string) {
	YUI().use('node', function(Y) {
		Y.one('#console').append(string +'<br style="margin-bottom:6px;"/>');
		var display = document.getElementById('console');
		display.scrollTop = display.scrollHeight;
	});
}

//Render new album in browser
YUI().use('node', function(Y) {
	socket.on('new album', function(album) {
		console.log('Album recieved: '+ album[0].album);
		pendingAlbums--;
		var mediaObj = Y.Node.create('<div class="media"></div>');
		var mediaHead = Y.Node.create('<a class="pull-left"></a>');
		mediaHead.appendChild(Y.Node.create('<img class="media-object" style="width: 150px;" src="data:image/jpeg;base64,'+ album[0].image +'">'));
		var mediaBody = Y.Node.create('<div class="media-body"></div>');
		var heading = Y.Node.create('<div class="media-heading"></div>');
		heading.appendChild(Y.Node.create('<h4 style="float: left; margin-top:0px;">'+ album[0].album +'</h4>'));
		if(album[0].allowDownload === 'yes') {
			heading.appendChild(Y.Node.create('<small class="dl-link" onclick="downloadAlbum(\''+ album[0].album +
			'\');"><i class="icon-arrow-down icon-white"></i>Download</small>'));
		}
		mediaBody.appendChild(heading);
		var disks = [[]];
		for(var i = 1; i<album.length; i++) {
			var track = Y.Node.create('<dl class="dl-horizontal track " id="t-'+ album[i].id +
					'" onclick="PlaySong(\''+album[i].id+'\', \''+album[i].title.replace(/\'/g, "\\'")+'\')"></dl>');
			track.appendChild(Y.Node.create('<dt style="width: 30px;">'+ album[i].track +'</dt>'));
			track.appendChild(Y.Node.create('<dd style="margin-left: 50px;">'+ album[i].title +'</dd>'));
			track.appendChild(Y.Node.create('<dd style="margin-left: 50px;"><em>'+ album[i].artist +'</em></dd>'));
			if(!disks[album[i].disk]) {
				var j = album[i].disk - disks.length + 1;
				while(j--) {
					disks.push([]);
				}
			}
			disks[album[i].disk].push(track);
		}
		if(disks.length == 1) {
			for(var i = 0; i < disks[0].length; i++) {
				mediaBody.appendChild(disks[0][i]);
			}
		} else {
			for (var j = 1; j < disks.length; j++) {
				if(disks[j].length > 0) {
					var disk = Y.Node.create('<div class="media-body"><h5 class="pull-left" style="width:100%;">Disk '+ j +'<h5></div>');
					for(var i = 0; i < disks[j].length; i++) {
						disk.appendChild(disks[j][i]);
					}
					mediaBody.appendChild(disk);
				}
			}
		}

		mediaObj.appendChild(mediaHead);
		mediaObj.appendChild(mediaBody);
		Y.one('#browser').appendChild(mediaObj);
	});
});

//Album download
function downloadAlbum(album) {
	consolePrintln('[Log] Requesting Download: <span style="color:#8FF;">'+ album +'</span>');
	socket.emit("request download", album);
}
socket.on("download link", function(data) {
	if(data.path === 'rejected') {
		consolePrintln('[Error] <span style="color:#FAA;">Download Request Rejected!</span>');
	} else if(data.path === 'preparing') {
		consolePrintln('[Warning] <span style="color:#FA0;">Please wait while previous download is prepared...</span>');
	} else {
		consolePrintln('[Log] Acquired Album: <span style="color:#8FF;">'+ data.album +'</span>');
		document.getElementById('downloader').src = location.href +'dl/'+ data.path;
	}
})

//Play new song
function PlaySong(id, title) {
	consolePrintln('[Log] Requesting Song: <span style="color:#8FF;">'+ title +'</span>');
	YUI().use('node', function(Y) {
		var active = Y.one('.track-active')
		if(active) active.removeClass('track-active');
		Y.one('#t-'+id).addClass('track-active');
	});
	socket.emit('request playlist', id);
	socket.emit('request track', id);
}
//Play next song
player.addEventListener('ended', function() {
	if(playlistArray && playlistArray.length != 0) {
		PlaySong(playlistArray[playlistIndex].id, playlistArray[playlistIndex].title.replace(/\'/g, "\\'"));
		playlistArray.shift();
	}
});

//Build Playlist
socket.on('track playlist', function(playlist) {
	playlistArray = playlist.slice(1);
	YUI().use('node', function(Y) {
		Y.one('#track-playlist').setContent('');
		for(var i = 1; i<playlist.length; i++) {
			var track = Y.Node.create('<dl class="dl-horizontal playlistTrack" id="p-'+ playlist[i].id +
					'" onclick="PlaySong(\''+playlist[i].id+'\', \''+playlist[i].title.replace(/\'/g, "\\'")+'\')"></dl>');
			track.appendChild(Y.Node.create('<dt style="width: 30px;">'+ playlist[i].track +'</dt>'));
			track.appendChild(Y.Node.create('<dd style="margin-left: 50px;">'+ playlist[i].title +'</dd>'));
			track.appendChild(Y.Node.create('<dd style="margin-left: 50px;"><em>'+ playlist[i].artist +'</em></dd>'));
			if(playlist[i].id == playlist[0]) {
				track.addClass('playlist-active');
				playlistIndex = i;
			}
			Y.one('#track-playlist').appendChild(track);
		}
	});
});

//Track Info for player
socket.on('track info', function(meta) {
	console.log('Track recieved: '+ meta.Title);
	YUI().use('node', function(Y) {
		Y.one('#track-artwork').setStyle('backgroundImage', 'url("data:image/jpeg;base64,'+ meta.image +'")');
		Y.one('#track-title').setContent(meta.Title);
		Y.one('#track-album').setContent(meta.Album);
		var table = '<h4 style="position:relative; top:10px; left:10px; margin-top:0px;">Media Info:</h4><table>';
		for (var key in meta) {
			if(key === 'Format') {
				meta[key] = meta[key].replace('s', 'Signed ').replace('u', 'Unsigned ') + '-bit';
				if(/p/i.test(meta[key])) {
					meta[key] = meta[key].replace('p', '') + ', Planar';
				}
			}
			if(key === 'SampleRate') {
				meta[key] = (parseInt(meta[key],10)/1000) +' kHz';
			}
			if(key === 'BitRate') {
				meta[key] = (parseInt(meta[key],10)/1000) +' kbit/s';
			}
			if(key != 'image') {
				table += '<tr><td style="padding: 5px 10px 5px;">' + key + ': </td><td>' + meta[key] + '</td></tr>';
			}
		}
		table += '</table>';
		Y.one('#track-info').setContent(table);
	});
})
//Track URL for player
socket.on('track data', function(data) {
	consolePrintln('[Log] Acquired Song: <span style="color:#8FF;">'+ data.title +'</span>');
	player.src = 'dat/'+data.file;
	player.load();
});
//Start player
player.addEventListener('loadeddata', function() {
	player.play();
});

//Search function
function transportSearch() {
	YUI().use('node', function(Y) {
		Y.one('#filter-box').setStyle('backgroundColor', '#FFF');
		var input = document.getElementById('filter-box').value;
		socket.emit('search', input);
		pendingAlbums = 10;
		Y.one('#browser').setContent('');
	});
}
//Display media info
function transportInfo() {
	YUI().use('node', 'transition', function(Y) {
		if(Y.one('#track-playlist').getStyle('opacity') != '0') {
			transportPlaylist();
		}
		var target = 0, opacity = Y.one('#track-info').getStyle('opacity');
		if(opacity != '1') {
			target = 1;
			Y.one('#track-info').setStyle('display', 'block')
			Y.one('#media-info').addClass('active');
		}
		Y.one('#track-info').transition({
			duration: 0.3,
			easing: 'ease-out',
			opacity: target,
		});
		if(!target) {
			Y.one('#track-info').setStyle('display', 'none');
			Y.one('#media-info').removeClass('active');
		}
	});
}
//Display Playlist
function transportPlaylist() {
	YUI().use('node', 'transition', function(Y) {
		if(Y.one('#track-info').getStyle('opacity') != '0') {
			transportInfo();
		}
		var target = 0, opacity = Y.one('#track-playlist').getStyle('opacity');
		if(opacity != '1') {
			target = 1;
			Y.one('#track-playlist').setStyle('display', 'block')
			Y.one('#playlist').addClass('active');
		}
		Y.one('#track-playlist').transition({
			duration: 0.3,
			easing: 'ease-out',
			opacity: target,
		});
		if(!target) {
			Y.one('#track-playlist').setStyle('display', 'none');
			Y.one('#playlist').removeClass('active');
		}
	});
}

//Search bar Autocomplete
socket.on('genre list', function(genreList) {
	YUI().use('autocomplete', 'autocomplete-highlighters', function (Y) {
		Y.one('#filter-box').plug(Y.Plugin.AutoComplete, {
			resultHighlighter: 'subWordMatch',
			source: genreList
		});
	});
});

//Request more albums when scrolled near bottom
//Check server still online
setInterval(function() {
	var browser = document.getElementById('browser');
	if(browser.scrollHeight - browser.scrollTop < 4000 && pendingAlbums <= 0) {
		socket.emit('more albums', 5);
		pendingAlbums += 5;
	}
	if(serverOnline != socket.connected) {
		serverOnline = socket.connected;
		if(socket.connected) consolePrintln('[Log] Socket Connected.');
		else consolePrintln('[Error] <span style="color:#FAA;">Socket Disconnected!</span>');
	}
}, 500);

//Keyboard events
YUI().use("node", function(Y) {
	Y.one('document').on("keypress",  function(e) {
		if(e.keyCode == 32 && document.getElementById('filter-box') != document.activeElement) { // space pressed and not in search bar
			if(player.paused) player.play();
			else player.pause();
		}
	});
});

//Set session ID
socket.on('socket created', function(hostname){
	sessionID = socket.io.engine.id;
	if(hostname) {
		YUI().use('node', function(Y) {
			Y.one('title').setHTML('Yui @ '+ hostname);
			Y.one('#menu').setHTML('<span style="font-size: 16px;">Yui | </span>Web-based Music Library / Player @ '+ hostname);
		});
	}
});

//Signal UI init (Keep at bottom of page)
console.log('[Socket] Request Init');
socket.emit('init');
pendingAlbums = 10;

//END OF FILE ---------------------------------------------
