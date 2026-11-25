// wsHook - WebSocket Interception
// based on https://github.com/skepticfx/wshook

var wsHook = {};
var WAdebugEnabled = document.currentScript?.hasAttribute("data-wa-incognito-debug") === true;
const waInterceptionStages = Object.create(null);

function WAIncognitoDebug(stage, details)
{
	if (!WAdebugEnabled) return;
	waInterceptionStages[stage] = (waInterceptionStages[stage] ?? 0) + 1;
	if (waInterceptionStages[stage] === 1)
		console.info("[WAIncognito debug][page]", stage, details ?? "");
}

(function() 
{
	var before = wsHook.before = function(data, url) 
	{
		return data;
	};
	var after = wsHook.after = function(e, url) 
	{
		return e;
	};
	wsHook.resetHooks = function() 
	{
		wsHook.before = before;
		wsHook.after = after;
	}

	var _WS = WebSocket; // save the original constructor

	// hook it
	const hookedWebSocket = WebSocket = function(url, protocols)
	{
		WAIncognitoDebug("WebSocket constructed");
		var WSObject;
		this.url = url;
		this.protocols = protocols;
		if (!this.protocols)
		WSObject = new _WS(url);
		else
		WSObject = new _WS(url, protocols);

		if (WAdebugEnabled)
		{
			WSObject.addEventListener("open", () => WAIncognitoDebug("WebSocket opened"));
			WSObject.addEventListener("error", () => WAIncognitoDebug("WebSocket error event"));
			WSObject.addEventListener("close", event => WAIncognitoDebug("WebSocket closed", {
				code: event.code, clean: event.wasClean
			}));
		}

		var _send = WSObject.send;
		var _wsobject = this;
		wsHook._send = WSObject.send = function(data) 
		{
			WAIncognitoDebug("WebSocket send");
			if (wsHook.before === before) WAIncognitoDebug("send before interception callback installed");
			//data = wsHook.before(data, WSObject.url) || data;
			new wsHook.before(data, WSObject.url).then(function (newData)
			{
				// TODO: there could be an error "WebSocket is already in CLOSING or CLOSED state."
				if (newData != null)
					_send.apply(WSObject, [newData]);
				
			}).catch(function(e)
			{
				console.error(e);
				_send.apply(WSObject, [data]);  
			});
		}

		// Events needs to be proxied and bubbled down.
		var onmessageFunction;
		WSObject.__defineSetter__('onmessage', function(func) 
		{
			if (typeof func === "function") WAIncognitoDebug("WebSocket onmessage registered");
			onmessageFunction = wsHook.onMessage = func;
		});
		WSObject.addEventListener('message', function(event) 
		{
			WAIncognitoDebug("WebSocket message received");
			if (!onmessageFunction)
			{
				WAIncognitoDebug("message without onmessage handler");
				console.log("warning: no onmessageFunction");
				return;
			}
		
			if (wsHook.after === after) WAIncognitoDebug("receive before interception callback installed");
			wsHook.after(new MutableMessageEvent(event), this.url).then(function(modifiedEvent)
			{
				if (modifiedEvent != null)
					onmessageFunction.apply(this, [modifiedEvent]);
				
			}).catch(function(e)
			{
				console.error(e);
				onmessageFunction.apply(this, [event]);
			});
			
			//e = new MessageEvent(e.type, e);
		});

		return WSObject;
	};
	WAIncognitoDebug("WebSocket hook installed");

	window.WAIncognitoInterceptionReport = function()
	{
		const noise = window.MultiDevice;
		return {
			enabled: WAdebugEnabled,
			webSocketHookActive: WebSocket === hookedWebSocket,
			outgoingHandlerInstalled: wsHook.before !== before,
			incomingHandlerInstalled: wsHook.after !== after,
			keyImportHookActive: Boolean(noise?.importKeyHook && crypto.subtle.importKey === noise.importKeyHook),
			readKeyAvailable: Boolean(noise?.readKey),
			writeKeyAvailable: Boolean(noise?.writeKey),
			incomingQueueSize: noise?.incomingQueue?.queue.length ?? null,
			outgoingQueueSize: noise?.outgoingQueue?.queue.length ?? null,
			commsWorker: window.WAIncognitoCommsModeFix ? { ...window.WAIncognitoCommsModeFix } : null,
			stages: { ...waInterceptionStages }
		};
	};
	if (WAdebugEnabled)
	{
		const logReport = reason =>
		{
			if (WAdebugEnabled) console.info("[WAIncognito debug][page]", reason, window.WAIncognitoInterceptionReport());
		};
		document.addEventListener("onInterceptionDebugSnapshot", () => logReport("snapshot at UI warning"));
		setTimeout(() => logReport("snapshot 10 seconds after WebSocket hook"), 10000);
	}
})();

// Mutable MessageEvent.
// Subclasses MessageEvent and makes data, origin and other MessageEvent properites mutatble.
function MutableMessageEvent(o) 
{
	this.bubbles = o.bubbles || false;
	this.cancelBubble = o.cancelBubble || false;
	this.cancelable = o.cancelable || false;
	this.currentTarget = o.currentTarget || null;
	this.data = o.data || null;
	this.defaultPrevented = o.defaultPrevented || false;
	this.eventPhase = o.eventPhase || 0;
	this.lastEventId = o.lastEventId || "";
	this.origin = o.origin || "";
	this.path = o.path || new Array(0);
	this.ports = o.parts || new Array(0);
	this.returnValue = o.returnValue || true;
	this.source = o.source || null;
	this.srcElement = o.srcElement || null;
	this.target = o.target || null;
	this.timeStamp = o.timeStamp || null;
	this.type = o.type || "message";
	this.__proto__ = o.__proto__ || MessageEvent.__proto__;
}
