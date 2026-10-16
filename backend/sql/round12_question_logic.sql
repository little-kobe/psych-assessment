-- 第12轮：题目逻辑（题目关联、跳题逻辑、选项关联）
-- 在 Navicat 里选中 psych_assessment 数据库后执行（只新增字段，不改动已有数据）
-- 上线的服务器上执行：mysql psych_assessment < /srv/psych-assessment/backend/sql/round12_question_logic.sql

-- 1. 每道题的逻辑设置（格式说明见 backend/logic.js 开头）
ALTER TABLE `questions`
  ADD COLUMN `logic` json NULL COMMENT '题目关联、跳题逻辑、选项关联的设置，NULL 表示没有';

-- 2. 跳题逻辑「直接提交为无效答卷」：标记为无效，不进入统计，导出时注明
ALTER TABLE `submissions`
  ADD COLUMN `is_invalid` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = 被跳题逻辑判为无效答卷';
