// 后端接口地址
// 本地开发（npm run dev）时是 http://localhost:3000；
// 上线后（npm run build）后台页面和接口在同一个网址下，由 nginx 转发，所以用相对地址。
export const API_BASE = import.meta.env.DEV ? "http://localhost:3000" : "";
