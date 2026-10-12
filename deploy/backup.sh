#!/bin/bash
# 每天自动备份数据库和上传的文件，保留最近 14 天
# 设置方法见上线指南「自动备份」一节（crontab 每天凌晨 3 点运行）
set -e
BACKUP_DIR=/srv/backup
mkdir -p "$BACKUP_DIR"
DAY=$(date +%Y%m%d)
# 读 backend/.env 里的数据库账号
set -a; source /srv/psych-assessment/backend/.env; set +a
mysqldump --single-transaction --no-tablespaces -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" | gzip > "$BACKUP_DIR/db_$DAY.sql.gz"
tar -czf "$BACKUP_DIR/uploads_$DAY.tar.gz" -C /srv/psych-assessment/backend uploads 2>/dev/null || true
find "$BACKUP_DIR" -type f -mtime +14 -delete
echo "$(date '+%F %T') 备份完成"
