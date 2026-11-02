// backend/createAdmin.js
// 一次性脚本：创建一个总账号（管理所有人）和一个研究者账号（普通权限），运行一次即可
// 导师账号登录后台后在「账号管理」里新建

const mysql = require("mysql2/promise");
const envFile = require("path").join(__dirname, ".env");
if (require("fs").existsSync(envFile)) process.loadEnvFile(envFile); // 服务器上读 backend/.env 里的数据库配置
const bcrypt = require("bcryptjs");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "xinli0824",
  database: process.env.DB_NAME || "psych_assessment",
};

async function createAdmins() {
  const connection = await mysql.createConnection(dbConfig);

  // 总账号：能看所有人的数据，管理所有账号
  const supervisorHash = await bcrypt.hash("supervisor123456", 10);
  await connection.execute(
    "INSERT INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    ["supervisor", supervisorHash, "总账号", "admin"],
  );

  // 普通研究者账号：只能看自己创建的数据
  const researcherHash = await bcrypt.hash("researcher123456", 10);
  await connection.execute(
    "INSERT INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    ["researcher1", researcherHash, "研究者张三", "researcher"],
  );

  await connection.end();
  console.log("两个账号创建成功：");
  console.log("总账号 - 用户名: supervisor，密码: supervisor123456");
  console.log("研究者账号 - 用户名: researcher1，密码: researcher123456");
  console.log("上线后请马上用 tools/set-password.js 把这两个默认密码改掉");
}

createAdmins().catch((err) => console.error("创建失败:", err));
