var Request = require('request');
var RSA = require('node-bignumber').Key;
var hex2b64 = require('node-bignumber').hex2b64;
var SteamID = require('steamid');

module.exports = SteamCommunity;

SteamCommunity.SteamID = SteamID;

function SteamCommunity() {
	this._jar = Request.jar();
	this._request = Request.defaults({"jar": this._jar});
}

SteamCommunity.prototype.login = function(details, callback) {
	if(details.steamID && details.sentry) {
		this._jar.setCookie(Request.cookie('steamMachineAuth' + details.steamID.getSteamID64() + '=' + encodeURIComponent(details.sentry)), 'https://steamcommunity.com');
	}
	
	var self = this;
	this._request.post("https://steamcommunity.com/login/getrsakey/", {"form": {"username": details.accountName}}, function(err, response, body) {
		if(err) {
			callback(err);
			return;
		}
		
		var json;
		try {
			json = JSON.parse(body);
		} catch(e) {
			callback(e);
			return;
		}
		
		var key = new RSA();
		key.setPublic(json.publickey_mod, json.publickey_exp);
		
		var form = {
			"captcha_text": "",
			"captchagid": -1,
			"emailauth": details.authCode || "",
			"emailsteamid": "",
			"loginfriendlyname": "",
			"password": hex2b64(key.encrypt(details.password)),
			"remember_login": false,
			"rsatimestamp": json.timestamp,
			"twofactorcode": "",
			"username": details.accountName
		};
		
		console.log(self._jar.getCookieString("https://steamcommunity.com"));
		self._request.post("https://steamcommunity.com/login/dologin/", {"form": form}, function(err, response, body) {
			if(err) {
				callback(err);
				return;
			}
			
			var json;
			try {
				json = JSON.parse(body);
			} catch(e) {
				callback(e);
				return;
			}
			
			if(!json.success) {
				callback(json.message);
			} else {
				var sessionID = generateSessionID();
				self._jar.setCookie(Request.cookie('sessionid=' + sessionID), 'http://steamcommunity.com');
				
				self.steamID = new SteamID(json.transfer_parameters.steamid);
				var cookies = self._jar.getCookieString("https://steamcommunity.com").split(';').map(function(cookie) {
					return cookie.trim();
				});
				
				// Find the Steam Guard cookie
				var steamguard = null;
				for(var i = 0; i < cookies.length; i++) {
					var parts = cookies[i].split('=');
					if(parts[0] == 'steamMachineAuth' + self.steamID) {
						steamguard = {"steamID": self.steamID, "sentry": decodeURIComponent(parts[1])};
						break;
					}
				}
				
				callback(null, sessionID, cookies, steamguard);
			}
		});
	});
};

SteamCommunity.prototype.setCookies = function(cookies) {
	var self = this;
	cookies.forEach(function(cookie) {
		var cookieName = cookie.match(/(.+)=/)[1];
		if(cookieName == 'steamLogin') {
			self.steamID = new SteamID(cookie.match(/=(\d+)/)[1]);
		}
		
		self._jar.setCookie(Request.cookie(cookie), (cookieName.match(/^steamMachineAuth/) || cookieName.match(/Secure$/) ? "https://" : "http://") + "steamcommunity.com");
	});
};

SteamCommunity.prototype.getSessionID = function() {
	var cookies = this._jar.getCookieString("http://steamcommunity.com").split(';');
	for(var i = 0; i < cookies.length; i++) {
		var match = cookies[i].trim().match(/([^=]+)=(.+)/);
		if(match[1] == 'sessionid') {
			return decodeURIComponent(match[2]);
		}
	}
	
	var sessionID = generateSessionID();
	this._jar.setCookie(Request.cookie('sessionid=' + sessionID), "http://steamcommunity.com");
	return sessionID;
};

function generateSessionID() {
	return Math.floor(Math.random() * 1000000000);
};

SteamCommunity.prototype._checkCommunityError = function(html, callback) {
	if(html.match(/<h1>Sorry!<\/h1>/)) {
		var match = html.match(/<h3>(.+)<\/h3>/);
		callback(match ? match[1] : "Unknown error occurred");
		return true;
	}
	
	return false;
};

SteamCommunity.prototype._myProfile = function(endpoint, form, callback) {
	var self = this;
	this._request("https://steamcommunity.com/my", {"followRedirect": false}, function(err, response, body) {
		if(err || response.statusCode != 302) {
			callback(err || "HTTP error " + response.statusCode);
			return;
		}
		
		var match = response.headers.location.match(/steamcommunity\.com(\/(id|profiles)\/[^\/]+)\/?/);
		if(!match) {
			callback("Can't get profile URL");
			return;
		}
		
		(form ? self._request.post : self._request)("https://steamcommunity.com" + match[1] + "/" + endpoint, form ? {"form": form} : {}, callback);
	});
};

require('./classes/CSteamGroup.js');