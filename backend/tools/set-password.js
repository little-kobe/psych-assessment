// backend/tools/set-password.js
// 修改后台账号的密码（上线后必须把默认密码改掉）。
// 用法（在 backend 文件夹里运行）：
//   node tools/set-password.js 账号 新密码
const mysql = require("mysql2/promise");
const envFile = require("path").join(__dirname, "../.env");
if (require("fs").existsSync(envFile)) process.loadEnvFile(envFile); // 服务器上读 backend/.env 里的数据库配置
const bcrypt = require("bcryptjs");

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.log("用法：node tools/set-password.js 账号 新密码");
  process.exit(1);
}
if (password.length < 8) {
  console.log("新密码至少 8 位，建议字母加数字");
  process.exit(1);
}

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "xinli0824",
    database: process.env.DB_NAME || "psych_assessment",
  });
  const hash = await bcrypt.hash(password, 10);
  const [r] = await connection.execute(
    "UPDATE admins SET password_hash = ? WHERE username = ?",
    [hash, username],
  );
  await connection.end();
  console.log(
    r.affectedRows > 0
      ? `账号「${username}」的密码已修改`
      : `没有找到账号「${username}」`,
  );
})().catch((err) => {
  console.error("修改失败：", err.message);
  process.exit(1);
});
