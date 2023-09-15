(function () {
  'use strict';

  var sessionManager = (function () {
    var second = 1000,
      minute = 60 * second,
      serverTimeOffset = 0,

      settings = {
        sessionCheckURL: '/coreapi/secured/sessions/current',
        sessionRefreshURL: '/coreapi/secured/sessions/refreshcurrent',
        logoutURL: '/logout',

        sessionExpiresOn: null,
        sessionLastRefresh: null,

        warningMessageThreshold: 5 * minute,
        sessionEndMessageThreshold: minute,

        sessionCheckInterval: 10 * second,
        sessionRefreshInterval: 10 * second,

        sessionExpired: false
      },
      callbacks = {},

      intervals = {
        countDown: '',
        checkSession: ''
      };

    function objectsAssign (objList) {
      var objs = objList ? objList: [];
      return objs.reduce(function (r, o) {
        Object.keys(o).forEach(function (k) {
          r[ k ] = o[ k ];
        });
        return r;
      }, {});
    };

    function getElement (methodName, attribute) {
      var arr = [];
      arr.remove = function() {};
      var elem = document[methodName](attribute),
        reservedElenment = methodName === 'getElementsByClassName'? arr :
          {
            remove: function() {}
          };
      return  elem;
    }
    /**
     * Logout from javascript
     */
    var logout = (function() {
      var logoutInitiated = false,
        oReq = new XMLHttpRequest();

      oReq.onload = function() {
        window.location.replace(settings.logoutURL);
      };
      return function(){
        //prevent multiple logout attempts
        if (!logoutInitiated) {
          oReq.open('POST',settings.logoutURL);
          oReq.setRequestHeader('Content-Type', 'application/json');
          oReq.setRequestHeader('session-manager', 'true');
          oReq.send();

          logoutInitiated = true;
        }
      }
    })();

    // Activate
    function activate(config) {
      config = config || {};

      // Plugin settings rewrite
      objectsAssign([settings, config]);

      // Force session refresh (sessionRefreshURL)
      sessionRefresh(true);

      // Check session every 10 seconds (sessionCheckURL)
      intervals.checkSession = setInterval(sessionCheckHandler, settings.sessionCheckInterval);

      // Countdown interval handler
      intervals.countDown = setInterval(countDownHandler, second);

      // Events for user refresh session
      setUserEventHandlers();

      // Set inline css styles in head
      setCSS();
    }

    function sessionCheckHandler() {
      callSessionAPI(settings.sessionCheckURL);
    }

    function updateServerTimeOffset(serverTime) {
      var clientTime = new Date().getTime();
      serverTimeOffset = serverTime - clientTime;
    }

    function updateSessionExpiresOn(expiresInSec, lastAccessedTime) {
      var expiresInMilliSec = expiresInSec * second;

      settings.sessionExpiresOn = lastAccessedTime + expiresInMilliSec;
      settings.sessionLastRefresh = lastAccessedTime;
    }

    function checkIfLoginRedirect (url) {
      if (!url) {
        url = '';
      }
      return url.indexOf(window.location.origin + '/login') > -1;
    }
    function callSessionAPI(url) {
      if (window.isOnLoginAsRequest) {
        return;
      }
      var oReq = new XMLHttpRequest();
      oReq.onload = function() {
        if (oReq && oReq.responseURL && checkIfLoginRedirect(oReq.responseURL)) {
          return logout();
        }
        if(oReq.readyState == XMLHttpRequest.DONE && oReq.status == 200) {
          var data;
          try {
            data = JSON.parse(oReq.responseText);
            console.log(data.id)
            debugger
            if (data && data.id) {
              window.postMessage({ id: data.id }, '*');
            }
          } catch (e) {
            console.log('Data is not json. Error is ', e);
          }
          if (data && data.expirationTimeoutSec && data.lastAccessedTime && data.serverTime) {
            updateServerTimeOffset(data.serverTime);
            updateSessionExpiresOn(data.expirationTimeoutSec, data.lastAccessedTime);
          } else {
            logout();
          }
        }
      };
      oReq.onerror = function(error) {
        console.error('error happened with getting session refresh data: ');
        console.log(error);
      };
      oReq.open('GET', url);
      oReq.setRequestHeader('Content-Type', 'application/json');
      oReq.setRequestHeader('pragma', 'no-cache');
      oReq.setRequestHeader('cache-control', 'no-store');
      oReq.setRequestHeader('session-manager', 'true');

      oReq.send();
    }

    function sessionRefresh(force) {
      if (force === true || (settings.sessionLastRefresh + settings.sessionRefreshInterval) < getCurrentTime()) {
        callSessionAPI(settings.sessionRefreshURL);
        for (var key in callbacks) {
          if (callbacks.hasOwnProperty(key)) {
            if(callbacks[key] && (typeof callbacks[key] === 'function')) {
              callbacks[key]();
            }
          }
        }

      }
    }
    function addRefreshCallback(key, callback){
      if (!callbacks.hasOwnProperty(key)){
        callbacks[key] = callback;
      }

    }

    function countDownHandler() {
      var currTime = getCurrentTime();
      if (settings.sessionExpiresOn && (settings.sessionExpiresOn - settings.warningMessageThreshold) <= currTime) {
        var type = 'session-end';
        var msg;

        if (settings.sessionExpiresOn < currTime) {
          // Protection from immediately logout
          if (settings.sessionExpiresOn !== null) {
            clearInterval(intervals.countDown);
            logout();
            return false;
          }
        } else {
          var minutes = Math.floor((settings.sessionExpiresOn - currTime) / second / 60);
          var seconds = Math.round((settings.sessionExpiresOn - currTime) / second - minutes * 60);

          if (seconds == 60) {
            seconds = 0;
            minutes++;
          }
          if (seconds.toString().length == 1) {
            seconds = '0' + seconds.toString();
          }
          if (minutes.toString().length == 1) {
            minutes = '0' + minutes.toString();
          }

          msg = 'Your session will expire in ' + minutes + ':' + seconds;
          if ((settings.sessionExpiresOn - settings.sessionEndMessageThreshold) > currTime) {
            type = 'warning';
          }
        }
        // Notifier only in top window
        if (window.self === window.top) {
          notify(msg, type);
        }
      } else {
        if (!settings.sessionExpired) {
          var sessionNotifyWrapper = getElement('getElementById', 'sessionNotifyWrapper'),
            widgetsOverlay =  getElement('getElementById', 'endWidgetOverlay');
          sessionNotifyWrapper && sessionNotifyWrapper.parentNode.removeChild(sessionNotifyWrapper);
          widgetsOverlay && widgetsOverlay.parentNode.removeChild(widgetsOverlay);
        }
      }
    }

    function notify(msg, type) {
      var sessionNotifyWrapper = getElement('getElementById', 'sessionNotifyWrapper');

      if (!sessionNotifyWrapper || sessionNotifyWrapper.length === 0) {
        sessionNotifyWrapper = document.createElement('div');
        sessionNotifyWrapper.setAttribute('id', 'sessionNotifyWrapper');
        sessionNotifyWrapper.classList.add('notify-wrapper-session');
        sessionNotifyWrapper.innerHTML = '<div id="sessionNotifyWrapper" class="notify-wrapper-session" />';
        document.body.appendChild(sessionNotifyWrapper);
      }

      // var widgets = sessionNotifyWrapper.getElementsByClassName('notify-widget');
      var widget = getElement('getElementById', 'notifyWidget');
      var endWidgetOverlay = getElement('getElementById', 'endWidgetOverlay');

      if (!widget || widget.length === 0) {
        widget = document.createElement('div');
        widget.setAttribute('id', 'notifyWidget');
        widget.classList.add('notify-widget', 'ui-corner-all');
        // innerHTML = '<div class="notify-widget ui-corner-all"></div>';
        sessionNotifyWrapper.appendChild(widget);
      }
      if (type == 'warning') {
        widget.classList.remove('session-end');
        widget.parentElement.classList.remove('session-end-wrapper');
        endWidgetOverlay && endWidgetOverlay.parentNode.removeChild(endWidgetOverlay);
      } else {
        var element = document.querySelector('body');
        var appendHtml = '<div id="endWidgetOverlay" class="ui-widget-overlay end-widget-overlay" style="z-index: 1111;"></div>';
        widget.classList.remove('warning');
        widget.parentElement.classList.add('session-end-wrapper');
        endWidgetOverlay && endWidgetOverlay.parentNode.removeChild(endWidgetOverlay);
        element.insertAdjacentHTML('beforeend', appendHtml);
      }

      widget.classList.add(type);
      widget.innerHTML = msg;
      // widget.show();
    }

    // Event handlers
    function setUserEventHandlers() {
      document.addEventListener('touchmove', sessionRefreshListener);
      document.addEventListener('mousemove', sessionRefreshListener);
      document.addEventListener('click', sessionRefreshListener);
      document.addEventListener('keypress', sessionRefreshListener);
    }

    function sessionRefreshListener(e) {
      this.removeEventListener(e.type, sessionRefreshListener);
      sessionRefresh();
      // Reveal handler
      setTimeout(function () {
        document.addEventListener(e.type, sessionRefreshListener);
      }, 5 * second);
    }

    function getCurrentTime() {
      var currentClientTime = new Date().getTime();
      return currentClientTime + serverTimeOffset;
    }

    function setCSS() {
      var head = document.head || document.getElementsByTagName('head')[0],
        style = document.createElement('style');

      var css = '.notify-wrapper {position: absolute; left: 0; top: 0; margin: 5px; z-index: 1000;}'
        + '.notify-wrapper .notify-widget {position: relative; left: 0; top: 0; margin: 5px; border: 1px #87938f solid; background: #eef0f1; opacity: 0.9; -moz-opacity: 0.9; filter: alpha(opacity=90); padding: 20px; color: #000000; font-weight: bold; width:300px;}'
        + '.notify-wrapper .notify-widget.notify-big {padding: 50px 20px;}'
        + '.notify-wrapper .notify-widget.warning {background-color: #FFAAAA; color:#000000;}'
        + '.notify-widget .notify-close {position: absolute; float: right; top: 0; right: 5px; cursor: pointer; font-weight: bold;}'
        + '.notify-wrapper-session {position: absolute; right: 0; top: 0; margin: 5px; z-index: 1120;}'
        + '.session-end-wrapper { right: 50%; top: 50%; margin:-115px -145px 0 0; font-size:13px;}'
        + '.notify-wrapper-session .notify-widget {position: relative; left: 0; top: 0; margin: 5px; border: 1px #87938f solid; opacity: 0.8; padding: 10px;}'
        + '.notify-wrapper-session .warning {background: #eeee00;}'
        + '.notify-wrapper-session .session-end {background: #ffaaaa;  padding: 40px;  text-align: center;}';

      style.type = 'text/css';

      if (style.styleSheet) {
        style.styleSheet.cssText = css;
      } else {
        style.appendChild(document.createTextNode(css));
      }

      head.appendChild(style);
    }

    // Public API
    return {
      settings: settings,
      activate: activate,
      addRefreshCallback: addRefreshCallback

    };

  })();

  // Global
  window.sessionManager = sessionManager;

})();
