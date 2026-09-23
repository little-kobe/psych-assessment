// 后端接口地址：跟随当前页面的主机名。
// 电脑上用 localhost 打开时就是 http://localhost:3000；
// 手机用局域网 IP（如 192.168.1.5）打开时，就自动变成 http://192.168.1.5:3000。
export const API_BASE = `http://${window.location.hostname}:3000`;
