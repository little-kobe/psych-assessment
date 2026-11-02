-- 第13轮：按键作答模式（记录按下用时、按住时长，可选每题把握程度）
-- 在 Navicat 里选中 psych_assessment 数据库后执行（只新增字段，不改动已有数据）
-- 上线的服务器上执行：mysql psych_assessment < /srv/psych-assessment/backend/sql/round13_key_response.sql

-- 1. 问卷的答题方式：click 点击作答（原来的方式）；key 按键作答（键盘字母键，手机上按住选项）
ALTER TABLE `questionnaires`
  ADD COLUMN `answer_mode` varchar(10) NOT NULL DEFAULT 'click' COMMENT '答题方式：click 点击，key 按键（记录按住时长）',
  ADD COLUMN `key_practice` tinyint NOT NULL DEFAULT 3 COMMENT '按键作答前的练习题数量，0 表示不练习',
  ADD COLUMN `key_confidence` tinyint(1) NOT NULL DEFAULT 0 COMMENT '按键作答时每题答完后是否询问把握程度（1-5）';

-- 2. 这份答卷实际用的答题方式（链接里可以指定，和问卷设置不一定相同）
ALTER TABLE `submissions`
  ADD COLUMN `answer_mode` varchar(10) NULL DEFAULT NULL COMMENT '这份答卷的答题方式：click / key';

-- 3. 每道题的按键数据（点击作答时为空）
ALTER TABLE `answers`
  ADD COLUMN `rt_ms` int NULL DEFAULT NULL COMMENT '按下用时：题目出现到按下按键的毫秒数',
  ADD COLUMN `hold_ms` int NULL DEFAULT NULL COMMENT '按住时长：按下到松开的毫秒数',
  ADD COLUMN `input_method` varchar(10) NULL DEFAULT NULL COMMENT '作答输入：key 键盘，touch 触屏',
  ADD COLUMN `confidence` tinyint NULL DEFAULT NULL COMMENT '受测者报告的把握程度 1-5';
