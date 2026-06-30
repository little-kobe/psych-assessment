// backend/createAdmin.js
// 一次性脚本：创建一个导师账号（超级管理员）和一个研究者账号（普通权限），运行一次即可

const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "xinli0824", // 改成你自己的
  database: "psych_assessment",
};

async function createAdmins() {
  const connection = await mysql.createConnection(dbConfig);

  // 导师账号：超级管理员，能看所有人的数据
  const supervisorHash = await bcrypt.hash("supervisor123456", 10);
  await connection.execute(
    "INSERT INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    ["supervisor", supervisorHash, "导师账号", "supervisor"],
  );

  // 普通研究者账号：只能看自己创建的数据
  const researcherHash = await bcrypt.hash("researcher123456", 10);
  await connection.execute(
    "INSERT INTO admins (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    ["researcher1", researcherHash, "研究者张三", "researcher"],
  );

  await connection.end();
  console.log("两个账号创建成功：");
  console.log("导师账号 - 用户名: supervisor，密码: supervisor123456");
  console.log("研究者账号 - 用户名: researcher1，密码: researcher123456");
}

createAdmins().catch((err) => console.error("创建失败:", err));
