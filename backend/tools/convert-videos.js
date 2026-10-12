// backend/tools/convert-videos.js
// 把 uploads 文件夹里已经上传的视频统一转成 H.264 的 mp4（所有浏览器都能播）。
// .mp4 文件原地转换、文件名不变；.mov / .webm 等会变成同名的 .mp4，并自动更新题目里保存的地址。
// 需要先装 ffmpeg。用法（在 backend 文件夹里运行）：
//   node tools/convert-videos.js
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const envFile = require("path").join(__dirname, "../.env");
if (require("fs").existsSync(envFile)) process.loadEnvFile(envFile); // 服务器上读 backend/.env 里的数据库配置
const video = require("../video");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const VIDEO_EXT = [".mp4", ".webm", ".m4v", ".mov"];

(async () => {
  if (!(await video.hasFfmpeg())) {
    console.log(
      "没有找到 ffmpeg，请先安装（Ubuntu：sudo apt install -y ffmpeg）",
    );
    process.exit(1);
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.log("没有 uploads 文件夹，不需要转换");
    return;
  }
  const files = fs
    .readdirSync(UPLOAD_DIR)
    .filter((f) => VIDEO_EXT.includes(path.extname(f).toLowerCase()))
    .filter((f) => !f.includes(".converting."));
  let converted = 0;
  const renamed = []; // [旧文件名, 新文件名]
  for (const f of files) {
    const full = path.join(UPLOAD_DIR, f);
    const codec = await video.videoCodec(full);
    const ext = path.extname(f).toLowerCase();
    if (codec === "h264" && ext === ".mp4") {
      console.log(`不用转换：${f}（已经是 H.264）`);
      continue;
    }
    process.stdout.write(`正在转换：${f}（原来是 ${codec || "未知格式"}）… `);
    const out = await video.toWebMp4(full);
    if (!out) {
      console.log("失败");
      continue;
    }
    if (path.resolve(out) !== path.resolve(full))
      renamed.push([f, path.basename(out)]);
    converted++;
    console.log("完成");
  }
  console.log(`共检查 ${files.length} 个视频，转换了 ${converted} 个`);

  // 扩展名变了的（如 .mov → .mp4），把题目里保存的地址一起改掉
  if (renamed.length > 0) {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "xinli0824",
      database: process.env.DB_NAME || "psych_assessment",
    });
    for (const [from, to] of renamed) {
      const [r] = await connection.execute(
        `UPDATE questions SET media = CAST(REPLACE(CAST(media AS CHAR), ?, ?) AS JSON)
         WHERE media IS NOT NULL AND CAST(media AS CHAR) LIKE ?`,
        [`/uploads/${from}`, `/uploads/${to}`, `%/uploads/${from}%`],
      );
      console.log(`${from} → ${to}，更新了 ${r.affectedRows} 道题`);
    }
    await connection.end();
  }
})().catch((err) => {
  console.error("出错了：", err.message);
  process.exit(1);
});
