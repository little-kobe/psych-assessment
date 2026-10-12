/*
 Navicat Premium Dump SQL

 Source Server         : 心理测评平台
 Source Server Type    : MySQL
 Source Server Version : 80046 (8.0.46)
 Source Host           : localhost:3306
 Source Schema         : psych_assessment

 Target Server Type    : MySQL
 Target Server Version : 80046 (8.0.46)
 File Encoding         : 65001

 Date: 12/10/2026 16:54:01
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for admins
-- ----------------------------
DROP TABLE IF EXISTS `admins`;
CREATE TABLE `admins`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '管理员账号',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '密码，加密存储',
  `display_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '显示名称',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'researcher' COMMENT '角色：researcher普通研究者，supervisor导师/超级管理员',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `username`(`username` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of admins
-- ----------------------------
INSERT INTO `admins` VALUES (1, 'supervisor', '$2b$10$j3TmN8hIM90YlF7Bgnm1m.mwFHKz2iEq7JOTFZ3WFet/SAt6TM1NK', '导师账号', 'supervisor', '2026-07-01 03:09:27');
INSERT INTO `admins` VALUES (2, 'researcher1', '$2b$10$xX5c4qFUYIvaf3Jiziit7uw15CQaspFAZiJKI3dAcRReSVBLaCY26', '研究者张三', 'researcher', '2026-07-01 03:09:27');

-- ----------------------------
-- Table structure for answers
-- ----------------------------
DROP TABLE IF EXISTS `answers`;
CREATE TABLE `answers`  (
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
) ENGINE = InnoDB AUTO_INCREMENT = 133 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of answers
-- ----------------------------
INSERT INTO `answers` VALUES (1, 1, 1, 5, 18523, NULL);
INSERT INTO `answers` VALUES (2, 1, 2, 5, 18523, NULL);
INSERT INTO `answers` VALUES (3, 1, 3, 5, 18523, NULL);
INSERT INTO `answers` VALUES (4, 2, 1, 4, 26295, NULL);
INSERT INTO `answers` VALUES (5, 2, 2, 3, 14358, NULL);
INSERT INTO `answers` VALUES (6, 2, 3, 5, 12346, NULL);
INSERT INTO `answers` VALUES (7, 2, 4, 5, 4654, NULL);
INSERT INTO `answers` VALUES (9, 2, 5, 5, 1940, NULL);
INSERT INTO `answers` VALUES (11, 3, 1, 5, 8154, NULL);
INSERT INTO `answers` VALUES (12, 3, 2, 5, 2374, NULL);
INSERT INTO `answers` VALUES (13, 3, 3, 5, 769, NULL);
INSERT INTO `answers` VALUES (14, 3, 4, 1, 13329, NULL);
INSERT INTO `answers` VALUES (16, 3, 5, 4, 2073, NULL);
INSERT INTO `answers` VALUES (18, 4, 1, 2, 4591, NULL);
INSERT INTO `answers` VALUES (19, 4, 2, 4, 1794, NULL);
INSERT INTO `answers` VALUES (20, 4, 3, 4, 1783, NULL);
INSERT INTO `answers` VALUES (21, 4, 4, 2, 1963, NULL);
INSERT INTO `answers` VALUES (22, 4, 5, 5, 2055, NULL);
INSERT INTO `answers` VALUES (23, 5, 10, 1, 7614, NULL);
INSERT INTO `answers` VALUES (24, 5, 11, 1, 3157, NULL);
INSERT INTO `answers` VALUES (25, 16, 12, NULL, 157073, '每天');
INSERT INTO `answers` VALUES (26, 16, 13, NULL, 2822, NULL);
INSERT INTO `answers` VALUES (27, 16, 14, NULL, 3920, '[\"打篮球\",\"游泳\"]');
INSERT INTO `answers` VALUES (28, 16, 15, NULL, 304264, '哈哈哈哈没意见');
INSERT INTO `answers` VALUES (29, 17, 12, NULL, 2701, '偶尔');
INSERT INTO `answers` VALUES (30, 17, 13, NULL, 1019, NULL);
INSERT INTO `answers` VALUES (31, 17, 14, NULL, 2649, '[\"打篮球\",\"游泳\"]');
INSERT INTO `answers` VALUES (32, 17, 15, NULL, 6118, '好的第二次测试');
INSERT INTO `answers` VALUES (33, 18, 12, NULL, 4591, '每天');
INSERT INTO `answers` VALUES (34, 18, 13, NULL, 5918, NULL);
INSERT INTO `answers` VALUES (35, 18, 14, NULL, 2060, '[\"打篮球\",\"游泳\",\"跑步\"]');
INSERT INTO `answers` VALUES (36, 18, 15, NULL, 8953, '这次我选了是');
INSERT INTO `answers` VALUES (37, 19, 12, NULL, 30498, '每天');
INSERT INTO `answers` VALUES (38, 19, 13, NULL, 2425, '是');
INSERT INTO `answers` VALUES (39, 19, 14, NULL, 5689, '[\"打篮球\",\"游泳\"]');
INSERT INTO `answers` VALUES (40, 19, 15, NULL, 8933, '这次我又选了是');
INSERT INTO `answers` VALUES (41, 20, 1, 3, 10858, NULL);
INSERT INTO `answers` VALUES (42, 20, 2, 1, 3933, NULL);
INSERT INTO `answers` VALUES (43, 20, 3, 1, 7619, NULL);
INSERT INTO `answers` VALUES (44, 20, 4, 1, 3768, NULL);
INSERT INTO `answers` VALUES (45, 20, 5, 1, 6282, NULL);
INSERT INTO `answers` VALUES (46, 21, 1, 1, 3024, NULL);
INSERT INTO `answers` VALUES (47, 21, 2, 1, 2511, NULL);
INSERT INTO `answers` VALUES (48, 21, 3, 1, 2692, NULL);
INSERT INTO `answers` VALUES (49, 21, 4, 1, 2603, NULL);
INSERT INTO `answers` VALUES (50, 21, 5, 1, 2345, NULL);
INSERT INTO `answers` VALUES (51, 22, 1, 1, 2782, NULL);
INSERT INTO `answers` VALUES (52, 22, 2, 1, 3137, NULL);
INSERT INTO `answers` VALUES (53, 22, 3, 1, 2471, NULL);
INSERT INTO `answers` VALUES (54, 22, 4, 1, 7062, NULL);
INSERT INTO `answers` VALUES (55, 22, 5, 1, 4792, NULL);
INSERT INTO `answers` VALUES (56, 23, 1, 1, 2489, NULL);
INSERT INTO `answers` VALUES (57, 23, 2, 1, 2551, NULL);
INSERT INTO `answers` VALUES (58, 23, 3, 1, 2430, NULL);
INSERT INTO `answers` VALUES (59, 23, 4, 1, 2276, NULL);
INSERT INTO `answers` VALUES (60, 23, 5, 1, 2233, NULL);
INSERT INTO `answers` VALUES (61, 24, 1, 1, 1616, NULL);
INSERT INTO `answers` VALUES (62, 24, 2, 1, 986, NULL);
INSERT INTO `answers` VALUES (63, 24, 3, 1, 1086, NULL);
INSERT INTO `answers` VALUES (64, 24, 4, 1, 910, NULL);
INSERT INTO `answers` VALUES (65, 24, 5, 1, 1216, NULL);
INSERT INTO `answers` VALUES (66, 25, 1, 1, 2134, NULL);
INSERT INTO `answers` VALUES (67, 25, 2, 1, 1000, NULL);
INSERT INTO `answers` VALUES (68, 25, 3, 1, 826, NULL);
INSERT INTO `answers` VALUES (69, 25, 4, 1, 808, NULL);
INSERT INTO `answers` VALUES (70, 25, 5, 1, 811, NULL);
INSERT INTO `answers` VALUES (71, 26, 1, 1, 13907, NULL);
INSERT INTO `answers` VALUES (72, 26, 2, 1, 1050, NULL);
INSERT INTO `answers` VALUES (73, 26, 3, 1, 1078, NULL);
INSERT INTO `answers` VALUES (74, 26, 4, 1, 1086, NULL);
INSERT INTO `answers` VALUES (75, 26, 5, 5, 1222, NULL);
INSERT INTO `answers` VALUES (76, 27, 1, 1, 12498, NULL);
INSERT INTO `answers` VALUES (77, 27, 2, 1, 934, NULL);
INSERT INTO `answers` VALUES (78, 27, 3, 1, 700, NULL);
INSERT INTO `answers` VALUES (79, 27, 4, 1, 1164, NULL);
INSERT INTO `answers` VALUES (80, 27, 5, 1, 1048, NULL);
INSERT INTO `answers` VALUES (81, 28, 1, 1, 26660, NULL);
INSERT INTO `answers` VALUES (82, 28, 2, 2, 1016, NULL);
INSERT INTO `answers` VALUES (83, 28, 3, 3, 800, NULL);
INSERT INTO `answers` VALUES (84, 28, 4, 2, 760, NULL);
INSERT INTO `answers` VALUES (85, 28, 5, 1, 1126, NULL);
INSERT INTO `answers` VALUES (86, 29, 1, 1, 36687, NULL);
INSERT INTO `answers` VALUES (87, 29, 2, 1, 2002, NULL);
INSERT INTO `answers` VALUES (88, 29, 3, 1, 1242, NULL);
INSERT INTO `answers` VALUES (89, 29, 4, 1, 1102, NULL);
INSERT INTO `answers` VALUES (90, 29, 5, 1, 877, NULL);
INSERT INTO `answers` VALUES (91, 30, 1, 2, 413591, NULL);
INSERT INTO `answers` VALUES (92, 30, 2, 3, 3214, NULL);
INSERT INTO `answers` VALUES (93, 30, 3, 3, 2836, NULL);
INSERT INTO `answers` VALUES (94, 30, 4, 4, 1562, NULL);
INSERT INTO `answers` VALUES (95, 30, 5, 4, 1786, NULL);
INSERT INTO `answers` VALUES (96, 31, 16, NULL, 25393, '轻微');
INSERT INTO `answers` VALUES (97, 32, 16, 1, 17979, '完全没有');
INSERT INTO `answers` VALUES (98, 32, 17, 3, 10416, '正常');
INSERT INTO `answers` VALUES (99, 33, 1, 5, 20621, NULL);
INSERT INTO `answers` VALUES (100, 33, 2, 5, 200394, NULL);
INSERT INTO `answers` VALUES (101, 33, 3, 5, 2641, NULL);
INSERT INTO `answers` VALUES (102, 33, 4, 1, 2400, NULL);
INSERT INTO `answers` VALUES (103, 33, 5, 1, 3132, NULL);
INSERT INTO `answers` VALUES (104, 34, 1, 5, 13901, NULL);
INSERT INTO `answers` VALUES (105, 34, 2, 5, 2052, NULL);
INSERT INTO `answers` VALUES (106, 34, 3, 5, 1921, NULL);
INSERT INTO `answers` VALUES (107, 34, 4, 5, 808, NULL);
INSERT INTO `answers` VALUES (108, 34, 5, 5, 5668, NULL);
INSERT INTO `answers` VALUES (109, 35, 1, 5, 10880, NULL);
INSERT INTO `answers` VALUES (110, 35, 2, 5, 2100, NULL);
INSERT INTO `answers` VALUES (111, 35, 3, 5, 2102, NULL);
INSERT INTO `answers` VALUES (112, 35, 4, 1, 2613, NULL);
INSERT INTO `answers` VALUES (113, 35, 5, 3, 1681, NULL);
INSERT INTO `answers` VALUES (114, 36, 16, 1, 47128, '完全没有');
INSERT INTO `answers` VALUES (115, 36, 17, 2, 2477, '轻微');
INSERT INTO `answers` VALUES (116, 36, 18, 3, 3657, '不错');
INSERT INTO `answers` VALUES (117, 37, 16, 1, 10279, '完全没有');
INSERT INTO `answers` VALUES (118, 37, 17, 4, 2406, '中度');
INSERT INTO `answers` VALUES (119, 37, 18, 3, 1462, '不错');
INSERT INTO `answers` VALUES (120, 38, 16, 1, 6933, '完全没有');
INSERT INTO `answers` VALUES (121, 38, 17, 1, 2310, '完全没有');
INSERT INTO `answers` VALUES (122, 38, 18, 3, 1462, '不错');
INSERT INTO `answers` VALUES (123, 39, 1, 5, 618389, NULL);
INSERT INTO `answers` VALUES (124, 39, 2, 4, 1319, NULL);
INSERT INTO `answers` VALUES (125, 39, 3, 3, 65193, NULL);
INSERT INTO `answers` VALUES (126, 39, 4, 1, 2694, NULL);
INSERT INTO `answers` VALUES (127, 39, 5, 1, 3450, NULL);
INSERT INTO `answers` VALUES (128, 40, 2, 1, 11259, NULL);
INSERT INTO `answers` VALUES (129, 40, 5, 5, 2962, NULL);
INSERT INTO `answers` VALUES (130, 40, 3, 4, 2415, NULL);
INSERT INTO `answers` VALUES (131, 40, 4, 1, 2031, NULL);
INSERT INTO `answers` VALUES (132, 40, 1, 4, 2702, NULL);

-- ----------------------------
-- Table structure for bundle_questionnaires
-- ----------------------------
DROP TABLE IF EXISTS `bundle_questionnaires`;
CREATE TABLE `bundle_questionnaires`  (
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

-- ----------------------------
-- Records of bundle_questionnaires
-- ----------------------------

-- ----------------------------
-- Table structure for bundles
-- ----------------------------
DROP TABLE IF EXISTS `bundles`;
CREATE TABLE `bundles`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '组合名称',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '组合说明',
  `created_by` int NULL DEFAULT NULL COMMENT '创建者',
  `is_active` tinyint(1) NULL DEFAULT 1,
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  `consent_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '知情同意说明，不填用默认文字',
  `shuffle` tinyint(1) NULL DEFAULT 0 COMMENT '每人随机打乱问卷顺序（平衡顺序效应）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `created_by`(`created_by` ASC) USING BTREE,
  CONSTRAINT `bundles_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of bundles
-- ----------------------------

-- ----------------------------
-- Table structure for dimension_questions
-- ----------------------------
DROP TABLE IF EXISTS `dimension_questions`;
CREATE TABLE `dimension_questions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `dimension_id` int NOT NULL COMMENT '所属维度',
  `question_id` int NOT NULL COMMENT '题目id',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `dimension_id`(`dimension_id` ASC) USING BTREE,
  INDEX `question_id`(`question_id` ASC) USING BTREE,
  CONSTRAINT `dimension_questions_ibfk_1` FOREIGN KEY (`dimension_id`) REFERENCES `dimensions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `dimension_questions_ibfk_2` FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 35 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of dimension_questions
-- ----------------------------
INSERT INTO `dimension_questions` VALUES (7, 3, 13);
INSERT INTO `dimension_questions` VALUES (8, 4, 12);
INSERT INTO `dimension_questions` VALUES (19, 5, 2);
INSERT INTO `dimension_questions` VALUES (20, 5, 3);
INSERT INTO `dimension_questions` VALUES (21, 5, 1);
INSERT INTO `dimension_questions` VALUES (22, 5, 5);
INSERT INTO `dimension_questions` VALUES (23, 6, 5);
INSERT INTO `dimension_questions` VALUES (24, 6, 4);
INSERT INTO `dimension_questions` VALUES (25, 6, 2);
INSERT INTO `dimension_questions` VALUES (26, 7, 19);
INSERT INTO `dimension_questions` VALUES (27, 8, 21);
INSERT INTO `dimension_questions` VALUES (28, 9, 23);
INSERT INTO `dimension_questions` VALUES (29, 9, 25);
INSERT INTO `dimension_questions` VALUES (30, 9, 27);
INSERT INTO `dimension_questions` VALUES (31, 9, 24);
INSERT INTO `dimension_questions` VALUES (32, 10, 24);
INSERT INTO `dimension_questions` VALUES (33, 10, 26);
INSERT INTO `dimension_questions` VALUES (34, 10, 23);

-- ----------------------------
-- Table structure for dimensions
-- ----------------------------
DROP TABLE IF EXISTS `dimensions`;
CREATE TABLE `dimensions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '维度名称',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '维度说明',
  `score_formula` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'sum' COMMENT '计分方式：sum求和，mean取均值',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `dimensions_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 11 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of dimensions
-- ----------------------------
INSERT INTO `dimensions` VALUES (3, 3, '焦虑', '', 'sum', '2026-07-05 00:36:13');
INSERT INTO `dimensions` VALUES (4, 3, '快乐', '', 'mean', '2026-07-05 00:36:13');
INSERT INTO `dimensions` VALUES (5, 1, '情绪总分', '', 'mean', '2026-09-24 00:00:58');
INSERT INTO `dimensions` VALUES (6, 1, '紧张', '', 'sum', '2026-09-24 00:00:58');
INSERT INTO `dimensions` VALUES (7, 4, '焦虑', '', 'sum', '2026-10-12 10:21:01');
INSERT INTO `dimensions` VALUES (8, 4, '快乐', '', 'mean', '2026-10-12 10:21:01');
INSERT INTO `dimensions` VALUES (9, 4, '情绪总分', '', 'mean', '2026-10-12 10:21:01');
INSERT INTO `dimensions` VALUES (10, 4, '紧张', '', 'sum', '2026-10-12 10:21:01');

-- ----------------------------
-- Table structure for norms
-- ----------------------------
DROP TABLE IF EXISTS `norms`;
CREATE TABLE `norms`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '常模名称，如 全国常模、男生',
  `source` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '来源说明，如 出处文献',
  `conditions` json NULL COMMENT '适用条件，空表示所有人，如[{\"field_key\":\"gender\",\"op\":\"eq\",\"value\":\"男\"}]',
  `norm_values` json NOT NULL COMMENT '各指标的均值和标准差，如{\"total\":{\"mean\":1.5,\"sd\":0.4}}',
  `order_num` int NULL DEFAULT 1,
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `norms_questionnaire_fk` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of norms
-- ----------------------------

-- ----------------------------
-- Table structure for option_templates
-- ----------------------------
DROP TABLE IF EXISTS `option_templates`;
CREATE TABLE `option_templates`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '模板名称',
  `options` json NOT NULL COMMENT '选项及分值，如[{\"label\":\"完全没有\",\"score\":1}]',
  `created_by` int NULL DEFAULT NULL COMMENT '创建者',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `created_by`(`created_by` ASC) USING BTREE,
  CONSTRAINT `option_templates_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of option_templates
-- ----------------------------
INSERT INTO `option_templates` VALUES (1, '测试模板', '[{\"label\": \"完全没有\", \"score\": 1}, {\"label\": \"轻度\", \"score\": 2}, {\"label\": \"中度\", \"score\": 3}, {\"label\": \"偏重\", \"score\": 4}, {\"label\": \"重度\", \"score\": 5}]', 1, '2026-09-23 19:25:12');

-- ----------------------------
-- Table structure for question_sections
-- ----------------------------
DROP TABLE IF EXISTS `question_sections`;
CREATE TABLE `question_sections`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '板块标题',
  `intro` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '板块引导语，显示在该板块每道题的上方',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  CONSTRAINT `question_sections_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of question_sections
-- ----------------------------

-- ----------------------------
-- Table structure for questionnaires
-- ----------------------------
DROP TABLE IF EXISTS `questionnaires`;
CREATE TABLE `questionnaires`  (
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
  `show_report_chart` tinyint(1) NULL DEFAULT 0 COMMENT '答完后是否向受测者展示维度得分图表',
  `total_formula` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT 'dimensions' COMMENT '总分算法',
  `norm_in_report` tinyint(1) NULL DEFAULT 0 COMMENT '受测者结果图表里是否显示常模平均',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `created_by`(`created_by` ASC) USING BTREE,
  CONSTRAINT `questionnaires_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admins` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of questionnaires
-- ----------------------------
INSERT INTO `questionnaires` VALUES (1, '情绪状态简评', '这里是问卷说明的测试', 1, '2026-07-01 01:32:11', NULL, '这里是知情同意，任何内容都可以加在这里,自定义区域', NULL, NULL, 1, 1, 'dimensions', 0);
INSERT INTO `questionnaires` VALUES (2, '心理状态测评', '测试', 1, '2026-07-01 03:57:21', 1, '', 100, NULL, 1, 0, 'dimensions', 0);
INSERT INTO `questionnaires` VALUES (3, '运动状态测试问卷', '问卷说明', 1, '2026-07-01 15:57:41', 1, '', NULL, NULL, 1, 0, 'dimensions', 0);
INSERT INTO `questionnaires` VALUES (4, '视觉想象生动性问卷', '本次测试旨在评估您的视觉想象的生动程度。评分标准：1=完全没有图像，你仅知道自己想着那个物体；', 1, '2026-07-17 10:01:46', 1, '', NULL, NULL, 1, 1, 'dimensions', 0);
INSERT INTO `questionnaires` VALUES (5, '测试是否可以导入其他', '', 1, '2026-10-12 01:36:51', 1, '', NULL, NULL, 1, 0, 'dimensions', 0);

-- ----------------------------
-- Table structure for questions
-- ----------------------------
DROP TABLE IF EXISTS `questions`;
CREATE TABLE `questions`  (
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
  `section_id` int NULL DEFAULT NULL COMMENT '所属板块（引导语）',
  `media` json NULL COMMENT '题目上方显示的图片/视频/音频，如[{\"type\":\"image\",\"url\":\"/uploads/xx.jpg\"}]',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  INDEX `section_id`(`section_id` ASC) USING BTREE,
  CONSTRAINT `questions_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `questions_section_fk` FOREIGN KEY (`section_id`) REFERENCES `question_sections` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 28 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of questions
-- ----------------------------
INSERT INTO `questions` VALUES (1, 1, '我今天感到心情愉快', 5, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (2, 1, '我今天感到精力充沛', 1, 1, 5, 0, 'scale', NULL, 'student', NULL, '[{\"url\": \"/uploads/1791771836414_f64f8ae1.jpeg\", \"name\": \"平面图.jpeg\", \"type\": \"image\"}, {\"url\": \"/uploads/1791771873734_34dc09c0.png\", \"name\": \"微信图片_20260905213027_333_262.png\", \"type\": \"image\"}]');
INSERT INTO `questions` VALUES (3, 1, '我今天感到注意力集中', 3, 1, 5, 0, 'scale', NULL, 'student', NULL, '[{\"url\": \"/uploads/1791772761921_b5aef5af.mp4\", \"name\": \"e702af0b7faf495f212f6e00872516e8.mp4\", \"type\": \"video\"}]');
INSERT INTO `questions` VALUES (4, 1, '我经常感到紧张不安', 4, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (5, 1, '我很少为一些小事而烦恼', 2, 1, 5, 1, 'scale', NULL, 'student', NULL, '[{\"url\": \"/uploads/1791771967100_1b18a396.mp3\", \"name\": \"music.mp3\", \"type\": \"audio\"}]');
INSERT INTO `questions` VALUES (10, 2, '我经常感到紧张不安', 4, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (11, 2, '我很少为一些小事而烦恼', 5, 1, 5, 1, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (12, 3, '你觉得时常开心吗', 3, 1, 5, 0, 'single_choice', '[\"偶尔\", \"从不\", \"每天\"]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (13, 3, '你每天运动吗', 1, 1, 5, 0, 'yes_no', '[]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (14, 3, '你喜欢干什么', 4, 1, 5, 0, 'multiple_choice', '[\"打篮球\", \"游泳\", \"跑步\"]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (15, 3, '说一说你的意见吧', 2, 1, 5, 0, 'open_text', '[]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (16, 4, '回想一位你常见的亲友（当下不在身边），仔细回想一下脑海中浮现的画面。面部、头部、肩膀和身体的精确轮廓。', 1, 1, 4, 0, 'single_choice', '[{\"label\": \"完全没有\", \"score\": 1}, {\"label\": \"轻微\", \"score\": 2}, {\"label\": \"正常\", \"score\": 3}, {\"label\": \"中度\", \"score\": 4}]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (17, 4, '是否感到难受', 2, 1, 4, 0, 'single_choice', '[{\"label\": \"完全没有\", \"score\": 1}, {\"label\": \"轻微\", \"score\": 2}, {\"label\": \"正常\", \"score\": 3}, {\"label\": \"中度\", \"score\": 4}]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (18, 4, '是否快乐', 3, 0, 3, 0, 'scale', '[{\"label\": \"完全不\", \"score\": 0}, {\"label\": \"一点\", \"score\": 1}, {\"label\": \"很少\", \"score\": 2}, {\"label\": \"不错\", \"score\": 3}]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (19, 4, '你每天运动吗', 4, 1, 5, 0, 'yes_no', '[]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (20, 4, '说一说你的意见吧', 5, 1, 5, 0, 'open_text', '[]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (21, 4, '你觉得时常开心吗', 6, 1, 5, 0, 'single_choice', '[\"偶尔\", \"从不\", \"每天\"]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (22, 4, '你喜欢干什么', 7, 1, 5, 0, 'multiple_choice', '[\"打篮球\", \"游泳\", \"跑步\"]', 'student', NULL, NULL);
INSERT INTO `questions` VALUES (23, 4, '我今天感到精力充沛', 8, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (24, 4, '我很少为一些小事而烦恼', 9, 1, 5, 1, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (25, 4, '我今天感到注意力集中', 10, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (26, 4, '我经常感到紧张不安', 11, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);
INSERT INTO `questions` VALUES (27, 4, '我今天感到心情愉快', 12, 1, 5, 0, 'scale', NULL, 'student', NULL, NULL);

-- ----------------------------
-- Table structure for responses
-- ----------------------------
DROP TABLE IF EXISTS `responses`;
CREATE TABLE `responses`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `answer_value` int NOT NULL COMMENT '受测者选择的答案（1-5分）',
  `duration_ms` int NULL DEFAULT NULL COMMENT '作答停留时长，单位毫秒',
  `submitted_at` datetime NULL DEFAULT NULL COMMENT '提交时间',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of responses
-- ----------------------------
INSERT INTO `responses` VALUES (1, 5, 10694, '2026-07-01 01:06:44');

-- ----------------------------
-- Table structure for score_rules
-- ----------------------------
DROP TABLE IF EXISTS `score_rules`;
CREATE TABLE `score_rules`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '所属问卷',
  `min_score` decimal(8, 2) NOT NULL COMMENT '分数段下限（含）',
  `max_score` decimal(8, 2) NOT NULL COMMENT '分数段上限（含）',
  `label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '该分数段的标签，如\"轻度\"',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '该分数段的详细描述',
  `visible_to_subject` tinyint(1) NULL DEFAULT 0 COMMENT '是否对受测者展示',
  `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP,
  `color` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT '#4CAF7D' COMMENT '分数段标签颜色，十六进制',
  `dimension_id` int NULL DEFAULT NULL COMMENT '适用的维度，NULL 表示按总分',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  INDEX `dimension_id`(`dimension_id` ASC) USING BTREE,
  CONSTRAINT `score_rules_dimension_fk` FOREIGN KEY (`dimension_id`) REFERENCES `dimensions` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `score_rules_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 23 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of score_rules
-- ----------------------------
INSERT INTO `score_rules` VALUES (19, 1, 5.00, 10.00, '重度', '轻度开心这是一段随机的生成的评价描述，以后如果想为某个分段的人群显示他们对应的分段或者评价就可以在这里详细的描述情况，当然也可以设置不给受测者看，只给管理员看。', 1, '2026-09-24 00:34:37', '#F44336', NULL);
INSERT INTO `score_rules` VALUES (20, 1, 11.00, 20.00, '中度', '中度开心的', 1, '2026-09-24 00:34:37', '#4CAF7D', NULL);
INSERT INTO `score_rules` VALUES (21, 1, 0.00, 5.00, '正常', '正常状态', 1, '2026-09-24 00:34:37', '#4CAF7D', 5);
INSERT INTO `score_rules` VALUES (22, 4, 0.00, 5.00, '正常', '正常状态', 1, '2026-10-12 10:21:01', '#4CAF7D', 9);

-- ----------------------------
-- Table structure for subject_info
-- ----------------------------
DROP TABLE IF EXISTS `subject_info`;
CREATE TABLE `subject_info`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `submission_id` int NOT NULL COMMENT '关联的提交记录',
  `field_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段标识',
  `field_label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '字段显示名',
  `value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT '填写的值',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `submission_id`(`submission_id` ASC) USING BTREE,
  CONSTRAINT `subject_info_ibfk_1` FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 64 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of subject_info
-- ----------------------------
INSERT INTO `subject_info` VALUES (1, 26, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (2, 26, 'age', '年龄', '15');
INSERT INTO `subject_info` VALUES (3, 26, 'sport_years', '运动年限（年）', '5');
INSERT INTO `subject_info` VALUES (4, 27, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (5, 27, 'age', '年龄', '15');
INSERT INTO `subject_info` VALUES (6, 27, 'sport_years', '运动年限（年）', '5');
INSERT INTO `subject_info` VALUES (7, 27, 'sport_type', '主要运动项目', '篮球');
INSERT INTO `subject_info` VALUES (8, 27, 'grade', '年级', '2');
INSERT INTO `subject_info` VALUES (9, 28, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (10, 28, 'age', '年龄', '12');
INSERT INTO `subject_info` VALUES (11, 28, 'sport_years', '运动年限（年）', '1');
INSERT INTO `subject_info` VALUES (12, 28, 'sport_type', '主要运动项目', '篮球');
INSERT INTO `subject_info` VALUES (13, 28, 'grade', '年级', '3');
INSERT INTO `subject_info` VALUES (14, 29, 'gender', '性别', '女');
INSERT INTO `subject_info` VALUES (15, 29, 'age', '年龄', '11');
INSERT INTO `subject_info` VALUES (16, 29, 'sport_years', '运动年限（年）', '4');
INSERT INTO `subject_info` VALUES (17, 29, 'sport_type', '主要运动项目', '1');
INSERT INTO `subject_info` VALUES (18, 29, 'grade', '年级', '5');
INSERT INTO `subject_info` VALUES (19, 30, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (20, 30, 'age', '年龄', '22');
INSERT INTO `subject_info` VALUES (21, 30, 'sport_years', '运动年限（年）', '2');
INSERT INTO `subject_info` VALUES (22, 30, 'sport_type', '主要运动项目', '篮球');
INSERT INTO `subject_info` VALUES (23, 30, 'grade', '年级', '1');
INSERT INTO `subject_info` VALUES (24, 31, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (25, 31, 'age', '年龄', '22');
INSERT INTO `subject_info` VALUES (26, 31, 'custom_1784255931548', '专业', '体育');
INSERT INTO `subject_info` VALUES (27, 32, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (28, 32, 'age', '年龄', '22');
INSERT INTO `subject_info` VALUES (29, 32, 'custom_1784255931548', '专业', '计算机');
INSERT INTO `subject_info` VALUES (30, 33, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (31, 33, 'age', '年龄', '22');
INSERT INTO `subject_info` VALUES (32, 33, 'sport_years', '运动年限（年）', '12');
INSERT INTO `subject_info` VALUES (33, 33, 'sport_type', '主要运动项目', '篮球');
INSERT INTO `subject_info` VALUES (34, 33, 'grade', '年级', '3');
INSERT INTO `subject_info` VALUES (35, 34, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (36, 34, 'age', '年龄', '11');
INSERT INTO `subject_info` VALUES (37, 34, 'sport_years', '运动年限（年）', '10');
INSERT INTO `subject_info` VALUES (38, 34, 'sport_type', '主要运动项目', '篮球');
INSERT INTO `subject_info` VALUES (39, 34, 'grade', '年级', '2');
INSERT INTO `subject_info` VALUES (40, 35, 'gender', '性别', '女');
INSERT INTO `subject_info` VALUES (41, 35, 'age', '年龄', '12');
INSERT INTO `subject_info` VALUES (42, 35, 'sport_years', '运动年限（年）', '1');
INSERT INTO `subject_info` VALUES (43, 35, 'sport_type', '主要运动项目', '足球');
INSERT INTO `subject_info` VALUES (44, 35, 'grade', '年级', '2');
INSERT INTO `subject_info` VALUES (45, 36, 'gender', '性别', '男');
INSERT INTO `subject_info` VALUES (46, 36, 'age', '年龄', '22');
INSERT INTO `subject_info` VALUES (47, 36, 'custom_1784255931548', '专业', '心理');
INSERT INTO `subject_info` VALUES (48, 37, 'gender', '性别', '女');
INSERT INTO `subject_info` VALUES (49, 37, 'age', '年龄', '18');
INSERT INTO `subject_info` VALUES (50, 37, 'custom_1784255931548', '专业', '心理学');
INSERT INTO `subject_info` VALUES (51, 38, 'gender', '性别', '女');
INSERT INTO `subject_info` VALUES (52, 38, 'age', '年龄', '12');
INSERT INTO `subject_info` VALUES (53, 38, 'custom_1784255931548', '专业', '心理');
INSERT INTO `subject_info` VALUES (54, 39, 'gender', '性别', '女');
INSERT INTO `subject_info` VALUES (55, 39, 'age', '年龄', '22');
INSERT INTO `subject_info` VALUES (56, 39, 'sport_years', '运动年限（年）', '3');
INSERT INTO `subject_info` VALUES (57, 39, 'sport_type', '主要运动项目', '篮球');
INSERT INTO `subject_info` VALUES (58, 39, 'grade', '年级', '2');
INSERT INTO `subject_info` VALUES (59, 40, 'gender', '性别', '女');
INSERT INTO `subject_info` VALUES (60, 40, 'age', '年龄', '12');
INSERT INTO `subject_info` VALUES (61, 40, 'sport_years', '运动年限（年）', '1');
INSERT INTO `subject_info` VALUES (62, 40, 'sport_type', '主要运动项目', '足球');
INSERT INTO `subject_info` VALUES (63, 40, 'grade', '年级', '2');

-- ----------------------------
-- Table structure for subject_info_fields
-- ----------------------------
DROP TABLE IF EXISTS `subject_info_fields`;
CREATE TABLE `subject_info_fields`  (
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
) ENGINE = InnoDB AUTO_INCREMENT = 12 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of subject_info_fields
-- ----------------------------
INSERT INTO `subject_info_fields` VALUES (4, 1, 'gender', '性别', 'radio', '[\"男\", \"女\", \"其他\"]', 1, 1);
INSERT INTO `subject_info_fields` VALUES (5, 1, 'age', '年龄', 'number', '[]', 1, 2);
INSERT INTO `subject_info_fields` VALUES (6, 1, 'sport_years', '运动年限（年）', 'number', '[]', 1, 3);
INSERT INTO `subject_info_fields` VALUES (7, 1, 'sport_type', '主要运动项目', 'text', '[]', 1, 4);
INSERT INTO `subject_info_fields` VALUES (8, 1, 'grade', '年级', 'text', '[]', 0, 5);
INSERT INTO `subject_info_fields` VALUES (9, 4, 'gender', '性别', 'radio', '[\"男\", \"女\", \"其他\"]', 1, 1);
INSERT INTO `subject_info_fields` VALUES (10, 4, 'age', '年龄', 'number', '[]', 1, 2);
INSERT INTO `subject_info_fields` VALUES (11, 4, 'custom_1784255931548', '专业', 'text', '[]', 1, 3);

-- ----------------------------
-- Table structure for submissions
-- ----------------------------
DROP TABLE IF EXISTS `submissions`;
CREATE TABLE `submissions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `questionnaire_id` int NOT NULL COMMENT '填的是哪份问卷',
  `started_at` datetime NULL DEFAULT NULL COMMENT '开始填写时间',
  `finished_at` datetime NULL DEFAULT NULL COMMENT '提交完成时间',
  `tracking_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '受测者自填追踪码，用于纵向研究关联多次提交',
  `group_label` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '分组标记，由链接参数传入',
  `bundle_id` int NULL DEFAULT NULL COMMENT '通过哪个问卷组合提交，NULL 表示单独的问卷链接',
  `bundle_token` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL DEFAULT NULL COMMENT '同一个人在一次组合作答中的几份问卷共用这个标记',
  `bundle_position` int NULL DEFAULT NULL COMMENT '这份问卷是他在组合里作答的第几份',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `questionnaire_id`(`questionnaire_id` ASC) USING BTREE,
  INDEX `bundle_token`(`bundle_token` ASC) USING BTREE,
  CONSTRAINT `submissions_ibfk_1` FOREIGN KEY (`questionnaire_id`) REFERENCES `questionnaires` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 41 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_general_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of submissions
-- ----------------------------
INSERT INTO `submissions` VALUES (1, 1, '2026-06-30 17:38:08', '2026-06-30 17:38:27', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (2, 1, '2026-06-30 20:11:27', '2026-06-30 20:11:53', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (3, 1, '2026-07-01 04:16:03', '2026-07-01 04:16:41', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (4, 1, '2026-07-01 05:03:36', '2026-07-01 05:03:48', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (5, 2, '2026-07-01 05:26:31', '2026-07-01 05:26:41', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (6, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:47', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (7, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:50', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (8, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:51', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (9, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:51', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (10, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:52', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (11, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:52', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (12, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:53', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (13, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:53', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (14, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:53', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (15, 3, '2026-07-01 12:15:50', '2026-07-01 12:18:53', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (16, 3, '2026-07-01 12:15:50', '2026-07-01 12:20:32', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (17, 3, '2026-07-01 12:22:06', '2026-07-01 12:22:22', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (18, 3, '2026-07-01 15:22:38', '2026-07-01 15:22:59', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (19, 3, '2026-07-01 15:25:18', '2026-07-01 15:26:07', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (20, 1, '2026-07-04 16:40:15', '2026-07-04 16:40:49', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (21, 1, '2026-07-04 16:42:42', '2026-07-04 16:42:55', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (22, 1, '2026-07-04 17:03:43', '2026-07-04 17:04:04', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (23, 1, '2026-07-04 17:37:21', '2026-07-04 17:37:33', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (24, 1, '2026-07-04 17:38:42', '2026-07-04 17:38:51', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (25, 1, '2026-07-04 17:56:06', '2026-07-04 17:56:14', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (26, 1, '2026-07-04 18:23:06', '2026-07-04 18:23:27', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (27, 1, '2026-07-04 18:28:53', '2026-07-04 18:29:12', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (28, 1, '2026-07-04 18:53:25', '2026-07-04 18:53:57', NULL, 'A班', NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (29, 1, '2026-07-04 18:53:37', '2026-07-04 18:54:21', NULL, 'B班', NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (30, 1, '2026-07-17 01:40:17', '2026-07-17 01:47:27', NULL, 'A班', NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (31, 4, '2026-07-17 02:45:12', '2026-07-17 02:45:37', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (32, 4, '2026-09-23 11:26:22', '2026-09-23 11:26:50', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (33, 1, '2026-09-23 16:35:43', '2026-09-23 16:39:32', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (34, 1, '2026-09-23 16:53:06', '2026-09-23 16:53:32', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (35, 1, '2026-09-23 16:54:27', '2026-09-23 16:54:48', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (36, 4, '2026-09-24 07:03:58', '2026-09-24 07:04:52', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (37, 4, '2026-09-24 07:05:44', '2026-09-24 07:05:59', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (38, 4, '2026-09-24 07:06:14', '2026-09-24 07:06:26', NULL, NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (39, 1, '2026-09-24 07:17:22', '2026-09-24 07:28:57', '2026210011', NULL, NULL, NULL, NULL);
INSERT INTO `submissions` VALUES (40, 1, '2026-09-24 07:47:33', '2026-09-24 07:47:55', NULL, NULL, NULL, NULL, NULL);

SET FOREIGN_KEY_CHECKS = 1;
