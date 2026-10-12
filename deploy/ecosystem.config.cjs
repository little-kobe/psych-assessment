// pm2 配置：让后端在服务器上一直运行，崩溃自动重启、开机自动启动
// 用法（在项目根目录）：pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "psych-backend",
      cwd: __dirname + "/../backend",
      script: "server.js",
      max_memory_restart: "600M",
      time: true, // 日志带时间
    },
  ],
};
