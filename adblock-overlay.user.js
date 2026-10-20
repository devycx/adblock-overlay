// ==UserScript==
// @name         隐形广告遮罩拦截器（点任意位置跳广告）
// @namespace    https://github.com/devycx/adblock-overlay
// @version      1.0.2
// @description  干掉移动端网页上「看不见但能点」的广告遮罩（position:fixed + opacity≈0.01 的全屏覆盖层），并拦截点击跳转广告的监听器、广告外链脚本与广告 WebSocket。
// @author       ycx
// @license      MIT
// @icon         https://raw.githubusercontent.com/devycx/adblock-overlay/main/icon.png
// @homepageURL  https://github.com/devycx/adblock-overlay
// @supportURL   https://github.com/devycx/adblock-overlay/issues
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  /* ===================== 广告特征 ===================== */

  // 广告域名家族：脚本会按日期/随机串拼子域名，但这些片段是固定的
  const AD_HOST = /8210g|mehqk5u|smun7ro/i;
  // 广告脚本内部特征串
  const AD_CODE = /brlvflxk|mehqk5u|smun7ro|8210g/i;
  // 广告 WebSocket 特征
  const AD_WS = /gw\.[a-z0-9-]+\.com|\/8210\b|:20095\b/i;

  const isAdHost = (u) => AD_HOST.test(String(u)) || /gw\.[a-z0-9-]+\.com/i.test(String(u));
  const isAdUrl = (u) => isAdHost(u) || AD_WS.test(String(u));

  // 隐形覆盖层：fixed/absolute + 几乎全透明(0 < opacity <= 0.05) + 带背景色或 vw 尺寸
  function isOverlayStyle(style) {
    if (!style) return false;
    if (!/position\s*:\s*(fixed|absolute)/i.test(style)) return false;
    const m = /opacity\s*:\s*([0-9.]+)/i.exec(style);
    if (!m) return false;
    const o = parseFloat(m[1]);
    if (!(o > 0 && o <= 0.05)) return false; // opacity:0 是正常隐藏，不要误伤
    return /background/i.test(style) || /width\s*:\s*[\d.]+vw/i.test(style);
  }

  /* ===================== 1. document.write：覆盖层改成不可见不可点 ===================== */

  function neutralize(html) {
    if (typeof html !== 'string' || html.indexOf('opacity') < 0) return html;
    return html.replace(/<([a-z][\w-]*)\b[^>]*>/gi, (tag) => {
      const m = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
      if (!m) return tag;
      const style = m[2] !== undefined ? m[2] : m[3];
      if (!isOverlayStyle(style)) return tag;
      const q = m[2] !== undefined ? '"' : "'";
      return tag.replace(m[0], m[0].slice(0, -1) + ';display:none!important;pointer-events:none!important' + q);
    });
  }

  const nativeWrite = document.write;
  document.write = function () {
    return nativeWrite.apply(document, Array.prototype.map.call(arguments, neutralize));
  };
  const nativeWriteln = document.writeln;
  document.writeln = function () {
    return nativeWriteln.apply(document, Array.prototype.map.call(arguments, neutralize));
  };

  /* ===================== 2. insertAdjacentHTML：同上 ===================== */

  const nativeIAH = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (position, html) {
    return nativeIAH.call(this, position, neutralize(html));
  };

  /* ===================== 3. addEventListener：丢弃广告跳转监听器 ===================== */

  const nativeAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if (typeof fn === 'function' && isAdHandler(fn)) return;
    return nativeAEL.call(this, type, fn, options);
  };

  function isAdHandler(fn) {
    let src;
    try {
      src = Function.prototype.toString.call(fn);
    } catch (e) {
      return false;
    }
    if (AD_CODE.test(src)) return true;
    // 通用特征：处理点击/触摸时直接跳到带端口的可疑外链
    if (!/location\s*(\.href\s*)?=|location\s*\.\s*(assign|replace)\s*\(/i.test(src)) return false;
    return (
      /:\d{4,5}\//.test(src) ||
      /\d{4,}[a-z0-9-]*\.[a-z0-9-]+\.(com|net|org|top|xyz|cc|vip|me|cn)\b/i.test(src)
    );
  }

  /* ===================== 4. WebSocket：拒绝广告服务器 ===================== */

  const NativeWS = window.WebSocket;
  function FakeWS() {
    this.readyState = 3;
    this.url = '';
  }
  FakeWS.prototype.close =
    FakeWS.prototype.send =
    FakeWS.prototype.addEventListener =
    FakeWS.prototype.removeEventListener =
      function () {};
  function GuardWS(url, protocols) {
    if (isAdUrl(url)) return new FakeWS();
    return new NativeWS(url, protocols);
  }
  GuardWS.prototype = NativeWS.prototype;
  GuardWS.CONNECTING = 0;
  GuardWS.OPEN = 1;
  GuardWS.CLOSING = 2;
  GuardWS.CLOSED = 3;
  window.WebSocket = GuardWS;

  /* ===================== 5. 外链脚本 / iframe：拦截广告地址 ===================== */

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (srcDesc && srcDesc.set) {
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get: srcDesc.get,
      set(v) {
        if (isAdHost(v)) {
          this.setAttribute('data-blocked-src', String(v));
          return;
        }
        srcDesc.set.call(this, v);
      },
    });
  }

  const nativeSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (/^(src|data-src)$/i.test(name) && isAdHost(value)) {
      nativeSetAttr.call(this, 'data-blocked-' + name, String(value));
      return;
    }
    return nativeSetAttr.call(this, name, value);
  };

  /* ===================== 6. new Function：广告脚本自解壳，直接拦掉 ===================== */

  const NativeFunction = window.Function;
  function GuardFunction() {
    const args = Array.prototype.slice.call(arguments);
    const body = args[args.length - 1];
    if (typeof body === 'string' && AD_CODE.test(body)) return function () {};
    return NativeFunction.apply(null, args);
  }
  GuardFunction.prototype = NativeFunction.prototype;
  window.Function = GuardFunction;

  /* ===================== 7. 兜底：清掉已经插进来的隐形覆盖层/广告脚本/撑高样式 ===================== */

  function clean(el) {
    if (!el || el.nodeType !== 1) return;
    if (isOverlayStyle(el.getAttribute('style'))) {
      el.remove();
      return;
    }
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'FRAME' || tag === 'EMBED') {
      if (isAdHost(el.getAttribute('src') || '')) {
        el.remove();
        return;
      }
    }
    if (tag === 'STYLE') {
      const t = el.textContent || '';
      if (/brlvflxk/i.test(el.id || '') || /position\s*:\s*initial\s*!important/i.test(t)) el.remove();
    }
  }

  new MutationObserver((list) => {
    for (const m of list) for (const el of m.addedNodes) clean(el);
  }).observe(document, { childList: true, subtree: true });
})();
