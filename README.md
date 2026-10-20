# 隐形广告遮罩拦截器（油猴脚本）

拦截移动端影视站上「看不见但能点」的隐形广告遮罩，以及点任意空白处跳广告站的劫持。

- Greasy Fork：https://greasyfork.org/zh-CN/scripts/601174
- 安装直链：https://update.greasyfork.org/scripts/601174/隐形广告遮罩拦截器（点任意位置跳广告）.user.js
- 源码：[adblock-overlay.user.js](adblock-overlay.user.js)

## 原理

典型 maccms 系影视站在移动端会注入：

1. `position:fixed` + `opacity:0.01` 的隐形覆盖层（几十个 div 铺满屏幕下半部），挂 `touchend` 后跳转广告域名；
2. 混淆壳脚本解包后再铺一层覆盖层 + 全局 `touchend` + 注入 `body{padding-bottom:100px}` + 连接广告 WebSocket 并 eval 下发代码。

本脚本按特征拦截：覆盖层样式（写入时改写为 `display:none;pointer-events:none`，出现后直接删除）、
带跳转逻辑的 `touchend` 监听器、`new Function` 自解壳、广告 WebSocket、广告外链脚本与撑高样式。

## 用法

装 Tampermonkey / Violentmonkey 后打开上面的 Greasy Fork 页面安装即可。对所有站点生效，但只按广告特征触发，普通网站不受影响。

## License

MIT
