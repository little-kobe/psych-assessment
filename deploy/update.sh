#!/bin/bash
# 以后代码有更新时，在服务器上运行：bash /srv/psych-assessment/deploy/update.sh
# 作用：从 GitHub 拉最新代码 → 装依赖 → 重新打包两个前端 → 重启后端
set -e
cd /srv/psych-assessment
echo "== 拉取最新代码"
# 直接和 GitHub 上的版本保持一致（服务器上 npm install 自动改动的 package-lock.json 会被还原）
# .env 和 uploads 不受影响；服务器上不要直接改代码，改动都在本地做、推送到 GitHub
git fetch
git reset --hard @{u}
echo "== 后端依赖"
(cd backend && npm install --no-audit --no-fund)
echo "== 打包答题端"
(cd frontend-user && npm install --no-audit --no-fund && npm run build)
echo "== 打包管理后台"
(cd frontend-admin && npm install --no-audit --no-fund && npm run build)
echo "== 重启后端"
pm2 restart psych-backend
echo "== 更新完成。如果这次更新带了 backend/sql/roundN_*.sql，记得再执行一次数据库升级"
