-- 心理测评平台 数据库表结构（仅结构，不含数据）
-- 来源：本地 MySQL 8.0 psych_assessment 库导出，2026-07-22
-- 用法：mysql -u root -p < schema.sql   （只会新建不存在的表，不会删除或覆盖已有数据）
-- 建好表后运行 backend/createAdmin.js 创建初始账号

CREATE DATABASE IF NOT EXISTS `psych_assessment` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `psych_assessment`;
SET NAMES utf8mb4;

-- admins
CREATE TABLE IF NOT EXISTS `admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '管理员账号',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '密码，加密存储',
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '显示名称',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'researcher' COMMENT '角色：researcher普通研究者，supervisor导师/超级管理员',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `username`(`username` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- questionnaires
CREATE TABLE IF NOT EXISTS `questionnaires` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '问卷标题',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '问卷说明',
  `track_timing` tinyint(1) NULL DEFAULT 1 COMMENT '是否记录作答时长，后台可配置开关',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` int NULL DEFAULT NULL COMMENT '创建该问卷的管理员id',
  `consent_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '知情同意说明文字，受测者填写前展示',
  `max_responses` int NULL DEFAULT NULL COMMENT '最大回收数量，NULL表示不限制',
  `expires_at` datetime NULL DEFAULT NULL COMMENT '问卷截止时间，NULL表示不限制',
  `is_active` tinyint(1) NULL DEFAULT 1 COMMENT '问卷是否开放，FALSE时受测者无法填写',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `created_by`(`created_by` ASC) USING BTREE,
  CONSTRAINT `questionnaires_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- questions
CREATE TABLE IF NOT EXISTS `questions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷id',
  `content` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '题目文字',
  `order_num` int NOT NULL COMMENT '题目顺序，从1开始',
  `min_score` int NULL DEFAULT 1 COMMENT '最低分（如李克特量表下限）',
  `max_score` int NULL DEFAULT 5 COMMENT '最高分',
  `is_reverse_scored` tinyint(1) NULL DEFAULT 0 COMMENT '是否反向计分题',
  `question_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'scale' COMMENT '题型：scale量表单选，single_choice单选，multiple_choice多选，yes_no是否，open_text开放题',
  `options` json NULL COMMENT '选项内容，JSON数组，如[\"从不\",\"偶尔\",\"经常\",\"总是\"]，量表题不填',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'student' COMMENT '填写角色：student学生，parent家长，both通用',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `questions_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- submissions
CREATE TABLE IF NOT EXISTS `submissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '填的是哪份问卷',
  `started_at` datetime NULL DEFAULT NULL COMMENT '开始填写时间',
  `finished_at` datetime NULL DEFAULT NULL COMMENT '提交完成时间',
  `tracking_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '受测者自填追踪码，用于纵向研究关联多次提交',
  `group_label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '分组标记，由链接参数传入',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `submissions_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- answers
CREATE TABLE IF NOT EXISTS `answers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL COMMENT '属于哪次提交',
  `question_id` int NOT NULL COMMENT '回答的是哪道题',
  `answer_value` int NULL DEFAULT NULL COMMENT '数值类答案，量表题用',
  `duration_ms` int NULL DEFAULT NULL COMMENT '这道题的作答耗时，毫秒',
  `answer_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '文字类答案，多选题存JSON数组，开放题存文字',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `submission_id`(`submission_id` ASC) USING BTREE,
  INDEX `question_id`(`question_id` ASC) USING BTREE,
  CONSTRAINT `answers_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `answers_ibfk_2` FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- dimensions
CREATE TABLE IF NOT EXISTS `dimensions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '维度名称',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '维度说明',
  `score_formula` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'sum' COMMENT '计分方式：sum求和，mean取均值',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `dimensions_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- dimension_questions
CREATE TABLE IF NOT EXISTS `dimension_questions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dimension_id` int NOT NULL COMMENT '所属维度',
  `question_id` int NOT NULL COMMENT '题目id',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `dimension_id`(`dimension_id` ASC) USING BTREE,
  INDEX `question_id`(`question_id` ASC) USING BTREE,
  CONSTRAINT `dimension_questions_ibfk_1` FOREIGN KEY (`dimension_id`) REFERENCES `dimensions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `dimension_questions_ibfk_2` FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- score_rules
CREATE TABLE IF NOT EXISTS `score_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `min_score` decimal(8, 2) NOT NULL COMMENT '分数段下限（含）',
  `max_score` decimal(8, 2) NOT NULL COMMENT '分数段上限（含）',
  `label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '该分数段的标签，如\"轻度\"',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '该分数段的详细描述',
  `visible_to_subject` tinyint(1) NULL DEFAULT 0 COMMENT '是否对受测者展示',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  `color` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT '#4CAF7D' COMMENT '分数段标签颜色，十六进制',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `score_rules_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- subject_info_fields
CREATE TABLE IF NOT EXISTS `subject_info_fields` (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL,
  `field_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段标识，如gender/age',
  `field_label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '显示名称，如性别/年龄',
  `field_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'text' COMMENT '字段类型：text文本，number数字，select单选，radio单选按钮',
  `options` json NULL COMMENT '选项内容，select/radio类型用',
  `is_required` tinyint(1) NULL DEFAULT 1 COMMENT '是否必填',
  `order_num` int NULL DEFAULT 1 COMMENT '显示顺序',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `subject_info_fields_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- subject_info
CREATE TABLE IF NOT EXISTS `subject_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL COMMENT '关联的提交记录',
  `field_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段标识',
  `field_label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段显示名',
  `value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '填写的值',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `submission_id`(`submission_id` ASC) USING BTREE,
  CONSTRAINT `subject_info_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- bundles  -- 问卷组合（表已建，代码尚未实现）
CREATE TABLE IF NOT EXISTS `bundles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '组合名称',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '组合说明',
  `created_by` int NULL DEFAULT NULL COMMENT '创建者',
  `is_active` tinyint(1) NULL DEFAULT 1,
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `created_by`(`created_by` ASC) USING BTREE,
  CONSTRAINT `bundles_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- bundle_questionnaires  -- 问卷组合明细（表已建，代码尚未实现）
CREATE TABLE IF NOT EXISTS `bundle_questionnaires` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bundle_id` int NOT NULL,
  `questionnaire_id` int NOT NULL,
  `order_num` int NOT NULL COMMENT '在组合中的顺序',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `bundle_id`(`bundle_id` ASC) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `bundle_questionnaires_ibfk_1` FOREIGN KEY (`bundle_id`) REFERENCES `bundles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bundle_questionnaires_ibfk_2` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- responses  -- 早期单题 demo 遗留，仅 /api/submit 使用
CREATE TABLE IF NOT EXISTS `responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `answer_value` int NOT NULL COMMENT '受测者选择的答案（1-5分）',
  `duration_ms` int NULL DEFAULT NULL COMMENT '作答停留时长，单位毫秒',
  `submitted_at` datetime NULL DEFAULT NULL COMMENT '提交时间',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;
