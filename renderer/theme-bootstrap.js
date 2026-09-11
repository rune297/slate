// 主题防闪引导：必须在 styles.css 生效前把 data-theme 写到 <html> 上。
// 取值：light（默认暖白）/ dark（深灰）；auto 跟随系统。
(function () {
  try {
    var pref = localStorage.getItem('slate-appearance') || 'light';
    var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  } catch (e) {
    /* localStorage 不可用时保持默认浅色 */
  }
})();
