// 后端接口地址
// 本地开发（npm run dev）时跟随当前页面的主机名：电脑上用 localhost 打开就是 http://localhost:3000，
// 手机用局域网 IP（如 192.168.1.5）打开时就自动变成 http://192.168.1.5:3000。
// 上线后（npm run build）页面和接口在同一个网址下，由 nginx 转发，所以用相对地址。
export const API_BASE = import.meta.env.DEV
  ? `http://${window.location.hostname}:3000`
  : "";
